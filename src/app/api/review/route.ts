import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { commitSourceImage } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// GET: the human-in-the-loop queue (layer [5]) — only the uncertain fields,
// grouped by source page, each with its crop region for side-by-side review.
export async function GET() {
  const images = await prisma.sourceImage.findMany({
    where: { status: "needs_review" },
    orderBy: { uploadedAt: "asc" },
    include: {
      reviewItems: { where: { status: "pending" }, orderBy: [{ rowIndex: "asc" }, { confidence: "asc" }] },
    },
  });

  const groups = images
    .filter((img) => img.reviewItems.length > 0)
    .map((img) => ({
      image: { id: img.id, url: img.url, docType: img.docType, note: img.note },
      items: img.reviewItems.map((r) => ({
        id: r.id,
        rowIndex: r.rowIndex,
        field: r.field,
        rawValue: r.rawValue,
        suggestedValue: r.suggestedValue,
        confidence: r.confidence,
        cropBox: r.cropBox ? JSON.parse(r.cropBox) : null,
      })),
    }));

  const totalPending = groups.reduce((n, g) => n + g.items.length, 0);
  return NextResponse.json({ groups, totalPending });
}

// POST: resolve one item (approve the suggestion, correct it, or reject the
// row's field). Each correction is persisted as a few-shot example so accuracy
// climbs with use. When a page has no pending items left, it auto-commits.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Bulk approve all pending items on a page.
  if (body.imageId && body.approveAll) {
    await prisma.reviewItem.updateMany({
      where: { sourceImageId: body.imageId, status: "pending" },
      data: { status: "approved", resolvedAt: new Date() },
    });
    const commit = await commitSourceImage(body.imageId);
    return NextResponse.json({ ok: true, ...commit });
  }

  const { itemId, action, value } = body as { itemId: string; action: "approve" | "correct" | "reject"; value?: string };
  if (!itemId || !action) return NextResponse.json({ error: "itemId and action required" }, { status: 400 });

  const item = await prisma.reviewItem.findUnique({ where: { id: itemId }, include: { sourceImage: true } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "correct") {
    await prisma.reviewItem.update({
      where: { id: itemId },
      data: { status: "corrected", correctedValue: value ?? "", resolvedAt: new Date() },
    });
    // Accuracy loop (Sprint 3): store the correction as a few-shot example.
    if (item.rawValue && value) {
      await prisma.correctionExample.create({
        data: { docType: item.sourceImage.docType, field: item.field, rawValue: item.rawValue, corrected: value },
      });
    }
  } else if (action === "reject") {
    await prisma.reviewItem.update({ where: { id: itemId }, data: { status: "rejected", resolvedAt: new Date() } });
  } else {
    await prisma.reviewItem.update({ where: { id: itemId }, data: { status: "approved", resolvedAt: new Date() } });
  }

  // Auto-commit the page once every field on it is resolved.
  const remaining = await prisma.reviewItem.count({ where: { sourceImageId: item.sourceImageId, status: "pending" } });
  let commit = null;
  if (remaining === 0) commit = await commitSourceImage(item.sourceImageId);

  return NextResponse.json({ ok: true, remaining, commit });
}
