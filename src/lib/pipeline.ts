import { prisma } from "@/lib/db";
import { getExtractor } from "@/lib/extract";
import type { DocType } from "@/lib/extract/types";
import { resolveDocument, type Catalogue } from "@/lib/resolve";
import { bestMatch } from "@/lib/resolve/fuzzy";

// Orchestrates layers [3]→[6]: extract a stored image, resolve/normalize against
// the catalogue, stage rows, and queue only the uncertain fields for review.

async function loadCatalogue(): Promise<Catalogue> {
  const variants = await prisma.variant.findMany({ include: { product: true } });
  const sellingPoints = await prisma.sellingPoint.findMany();
  return {
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      aliases: [v.product.name, `${v.product.name} ${safeAttrText(v.attributes)}`].filter(Boolean) as string[],
      sellPrice: v.sellPrice,
      costPrice: v.costPrice,
      unit: v.unit,
    })),
    sellingPoints: sellingPoints.map((s) => ({ id: s.id, name: s.name })),
  };
}

export async function processSourceImage(imageId: string) {
  const image = await prisma.sourceImage.findUnique({ where: { id: imageId } });
  if (!image) throw new Error("source image not found");

  await prisma.sourceImage.update({ where: { id: imageId }, data: { status: "processing" } });

  // Accuracy loop: feed past human corrections back as few-shot examples.
  const fewShot = await prisma.correctionExample.findMany({
    where: image.docType !== "unknown" ? { docType: image.docType } : {},
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  const extractor = getExtractor();
  const result = await extractor.extract({
    imageUrl: absoluteUrl(image.url),
    docTypeHint: image.docType === "unknown" ? undefined : (image.docType as DocType),
    seed: image.note ?? image.docType,
    fewShot: fewShot.map((c) => ({ field: c.field, rawValue: c.rawValue, corrected: c.corrected })),
  });

  // The model may correct the doc type — trust it when confident.
  if (result.docType !== image.docType && result.docTypeConfidence >= 0.8) {
    await prisma.sourceImage.update({ where: { id: imageId }, data: { docType: result.docType } });
  }

  const cat = await loadCatalogue();
  const resolved = resolveDocument(result, cat);

  // Reset any prior staging for idempotent re-processing.
  await prisma.stagedRow.deleteMany({ where: { sourceImageId: imageId, status: "pending" } });
  await prisma.reviewItem.deleteMany({ where: { sourceImageId: imageId, status: "pending" } });

  let pendingReviews = 0;
  for (const row of resolved.rows) {
    await prisma.stagedRow.create({
      data: {
        sourceImageId: imageId,
        docType: resolved.docType,
        rowIndex: row.rowIndex,
        payload: JSON.stringify(row.payload),
        needsReview: row.needsReview,
      },
    });
    for (const r of row.reviews) {
      pendingReviews++;
      await prisma.reviewItem.create({
        data: {
          sourceImageId: imageId,
          rowIndex: row.rowIndex,
          field: r.field,
          rawValue: r.rawValue ?? undefined,
          suggestedValue: r.suggestedValue ?? undefined,
          confidence: r.confidence,
          rowPayload: JSON.stringify(row.payload),
          cropBox: r.crop ? JSON.stringify(r.crop) : undefined,
        },
      });
    }
  }

  await prisma.sourceImage.update({
    where: { id: imageId },
    data: {
      status: pendingReviews > 0 ? "needs_review" : "extracted",
      processedAt: new Date(),
    },
  });

  return {
    docType: resolved.docType,
    rows: resolved.rows.length,
    pendingReviews,
    notes: resolved.notes,
    autoApproved: resolved.rows.length - resolved.rows.filter((r) => r.needsReview).length,
  };
}

// Commit every staged row for an image that no longer has pending reviews.
export async function commitSourceImage(imageId: string) {
  const pending = await prisma.reviewItem.count({ where: { sourceImageId: imageId, status: "pending" } });
  if (pending > 0) {
    return { committed: 0, blockedByReview: pending };
  }

  const staged = await prisma.stagedRow.findMany({ where: { sourceImageId: imageId, status: "pending" }, orderBy: { rowIndex: "asc" } });
  const reviews = await prisma.reviewItem.findMany({ where: { sourceImageId: imageId } });

  let committed = 0;
  for (const row of staged) {
    const payload = JSON.parse(row.payload);
    const rowReviews = reviews.filter((r) => r.rowIndex === row.rowIndex);
    const merged = await applyCorrections(payload, row.docType as DocType, rowReviews);
    await commitRow(row.docType as DocType, merged, imageId);
    await prisma.stagedRow.update({ where: { id: row.id }, data: { status: "committed", committedAt: new Date() } });
    committed++;
  }

  await prisma.sourceImage.update({ where: { id: imageId }, data: { status: "committed" } });
  return { committed, blockedByReview: 0 };
}

// Merge approved/corrected review values back into the staged payload.
async function applyCorrections(payload: any, docType: DocType, reviews: { field: string; status: string; correctedValue: string | null; suggestedValue: string | null }[]) {
  const out = { ...payload };
  for (const r of reviews) {
    const accepted = r.status === "corrected" ? r.correctedValue : r.suggestedValue;
    if (accepted == null) continue;
    switch (r.field) {
      case "product": {
        // Corrected product can be "id:<variantId>" or a label to re-match.
        if (accepted.startsWith("id:")) {
          out.variantId = accepted.slice(3);
        } else {
          const variants = await prisma.variant.findMany();
          const m = bestMatch(accepted, variants.map((v) => ({ id: v.id, label: v.label })));
          if (m && m.score >= 0.5) out.variantId = m.id;
          out.variantLabel = accepted;
        }
        break;
      }
      case "qty": out.qty = num(accepted); break;
      case "unitPrice": out.unitPrice = num(accepted); break;
      case "total": out.total = num(accepted); break;
      case "amount": out.amount = num(accepted); break;
      case "qtyOnHand": out.qtyOnHand = num(accepted); break;
      case "costPrice": out.costPrice = num(accepted); break;
      case "sellPrice": out.sellPrice = num(accepted); break;
      case "sellingPoint": out.sellingPointName = accepted; break;
      default: out[r.field] = accepted;
    }
  }
  return out;
}

async function commitRow(docType: DocType, p: any, imageId: string) {
  switch (docType) {
    case "product_list":
      return commitProduct(p);
    case "sales_sheet":
      return commitSale(p, imageId);
    case "expense":
      return commitExpense(p, imageId);
    case "stock_count":
      return commitStockCount(p, imageId);
  }
}

async function commitProduct(p: any) {
  const name = String(p.name ?? p.label ?? "Unnamed product").trim();
  const product =
    (await prisma.product.findFirst({ where: { name } })) ??
    (await prisma.product.create({ data: { name } }));
  await prisma.variant.create({
    data: {
      productId: product.id,
      label: String(p.label ?? name),
      attributes: JSON.stringify(p.attributes ?? {}),
      unit: p.unit ?? "pcs",
      costPrice: num(p.costPrice) ?? 0,
      sellPrice: num(p.sellPrice) ?? 0,
      currency: p.currency ?? "AMD",
    },
  });
}

async function commitSale(p: any, imageId: string) {
  if (!p.variantId) return; // unresolved product without a catalogue match is skipped
  const sellingPointId = await resolveSellingPoint(p.sellingPointId, p.sellingPointName);
  const qty = num(p.qty) ?? 0;
  const unitPrice = num(p.unitPrice) ?? 0;
  const total = num(p.total) ?? qty * unitPrice;
  const date = p.date ? new Date(`${p.date}T12:00:00Z`) : new Date();

  await prisma.sale.create({
    data: {
      variantId: p.variantId,
      sellingPointId,
      date,
      qty,
      unitPrice,
      total,
      currency: p.currency ?? "AMD",
      paymentMethod: p.paymentMethod ?? undefined,
      sourceImageId: imageId,
    },
  });

  // Auto-decrement variant stock + ledger movement.
  if (sellingPointId) {
    await prisma.stock.upsert({
      where: { variantId_sellingPointId: { variantId: p.variantId, sellingPointId } },
      create: { variantId: p.variantId, sellingPointId, qtyOnHand: -qty },
      update: { qtyOnHand: { decrement: qty } },
    });
  }
  await prisma.stockMovement.create({
    data: { variantId: p.variantId, sellingPointId, qtyDelta: -qty, reason: "sale", date, sourceImageId: imageId },
  });

  // Auto-consume raw materials via the bill of materials → true COGS.
  const bom = await prisma.billOfMaterials.findMany({ where: { variantId: p.variantId } });
  for (const b of bom) {
    const consumed = b.qtyUsed * qty;
    await prisma.rawMaterial.update({ where: { id: b.rawMaterialId }, data: { qtyOnHand: { decrement: consumed } } });
    await prisma.stockMovement.create({
      data: { rawMaterialId: b.rawMaterialId, qtyDelta: -consumed, reason: "bom_consume", date, sourceImageId: imageId },
    });
  }
}

async function commitExpense(p: any, imageId: string) {
  await prisma.expense.create({
    data: {
      date: p.date ? new Date(`${p.date}T12:00:00Z`) : new Date(),
      category: p.category ?? "other",
      vendor: p.vendor ?? undefined,
      amount: num(p.amount) ?? 0,
      currency: p.currency ?? "AMD",
      sourceImageId: imageId,
    },
  });
}

async function commitStockCount(p: any, imageId: string) {
  if (!p.variantId) return;
  const sellingPointId = await resolveSellingPoint(p.sellingPointId, p.sellingPointName);
  if (!sellingPointId) return;
  const counted = num(p.qtyOnHand) ?? 0;
  const existing = await prisma.stock.findUnique({ where: { variantId_sellingPointId: { variantId: p.variantId, sellingPointId } } });
  const prev = existing?.qtyOnHand ?? 0;
  const date = p.date ? new Date(`${p.date}T12:00:00Z`) : new Date();
  await prisma.stock.upsert({
    where: { variantId_sellingPointId: { variantId: p.variantId, sellingPointId } },
    create: { variantId: p.variantId, sellingPointId, qtyOnHand: counted },
    update: { qtyOnHand: counted },
  });
  await prisma.stockMovement.create({
    data: { variantId: p.variantId, sellingPointId, qtyDelta: counted - prev, reason: "count_adjust", date, sourceImageId: imageId },
  });
}

async function resolveSellingPoint(id: string | null, name: string | null): Promise<string | null> {
  if (id) return id;
  if (!name) return null;
  const existing = await prisma.sellingPoint.findFirst({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.sellingPoint.create({ data: { name, type: "kiosk" } });
  return created.id;
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

function safeAttrText(json: string): string {
  try {
    return Object.values(JSON.parse(json)).join(" ");
  } catch {
    return "";
  }
}

function absoluteUrl(url: string): string {
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}${url}`;
}
