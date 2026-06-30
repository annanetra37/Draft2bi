import type { ExtractionResult, DocType } from "@/lib/extract/types";
import { bestMatch, type MatchCandidate } from "./fuzzy";
import { normalizeDate, normalizeUnit, normalizeCurrency, normalizeCategory } from "./normalize";

export interface Catalogue {
  variants: (MatchCandidate & { sellPrice: number; costPrice: number; unit: string })[];
  sellingPoints: { id: string; name: string }[];
}

export interface ReviewDraft {
  field: string;
  rawValue: string | null;
  suggestedValue: string | null;
  confidence: number;
  crop?: { x: number; y: number; w: number; h: number } | null;
}

export interface ResolvedRow {
  rowIndex: number;
  payload: Record<string, any>;
  reviews: ReviewDraft[];
  needsReview: boolean;
}

export interface ResolvedDoc {
  docType: DocType;
  header: Record<string, any>;
  rows: ResolvedRow[];
  notes: string[];
}

const THRESHOLD = Number(process.env.REVIEW_CONFIDENCE_THRESHOLD ?? 0.85);

// Confidence at which a fuzzy product match is accepted as the suggestion.
const MATCH_SUGGEST = 0.55;

type FieldObj = { value: any; confidence: number; raw?: string; crop?: any };
const F = (x: any): FieldObj => (x && typeof x === "object" && "confidence" in x ? x : { value: x, confidence: 1 });

export function resolveDocument(result: ExtractionResult, cat: Catalogue): ResolvedDoc {
  switch (result.docType) {
    case "product_list":
      return resolveProductList(result);
    case "sales_sheet":
      return resolveSales(result, cat);
    case "expense":
      return resolveExpenses(result);
    case "stock_count":
      return resolveStock(result, cat);
    default:
      return { docType: result.docType, header: {}, rows: [], notes: result.notes ?? [] };
  }
}

// Resolve the header selling point against known points; resolve header date.
function resolveHeader(result: ExtractionResult, cat: Catalogue) {
  const header: Record<string, any> = {};
  const reviews: ReviewDraft[] = [];

  const spRaw = result.header?.sellingPoint ? F(result.header.sellingPoint) : null;
  if (spRaw && spRaw.value) {
    const m = bestMatch(String(spRaw.value), cat.sellingPoints.map((s) => ({ id: s.id, label: s.name })));
    if (m && m.score >= MATCH_SUGGEST) {
      header.sellingPointId = m.id;
      header.sellingPointName = m.label;
      header.sellingPointConfidence = round(spRaw.confidence * Math.min(1, 0.5 + m.score / 2));
    } else {
      header.sellingPointName = String(spRaw.value);
      header.sellingPointConfidence = round(spRaw.confidence * 0.5);
    }
  }

  const dRaw = result.header?.date ? F(result.header.date) : null;
  if (dRaw && dRaw.value) {
    const nd = normalizeDate(String(dRaw.value), undefined);
    header.date = nd.value;
    header.dateConfidence = round(dRaw.confidence * nd.confidence);
    if (header.dateConfidence < THRESHOLD) {
      reviews.push({ field: "date", rawValue: dRaw.raw ?? String(dRaw.value), suggestedValue: nd.value, confidence: header.dateConfidence, crop: dRaw.crop });
    }
  }
  if (header.sellingPointConfidence != null && header.sellingPointConfidence < THRESHOLD) {
    reviews.push({ field: "sellingPoint", rawValue: spRaw?.raw ?? null, suggestedValue: header.sellingPointName ?? null, confidence: header.sellingPointConfidence, crop: spRaw?.crop });
  }
  return { header, reviews };
}

function resolveProductList(result: ExtractionResult): ResolvedDoc {
  const rows: ResolvedRow[] = result.rows.map((raw, i) => {
    const name = F(raw.name);
    const label = F(raw.variantLabel);
    const attrs = F(raw.attributes);
    const unit = F(raw.unit);
    const cost = F(raw.costPrice);
    const sell = F(raw.sellPrice);
    const cur = F(raw.currency);

    const nu = normalizeUnit(unit.value);
    const nc = normalizeCurrency(cur.value);

    const fields: Record<string, number> = {
      name: name.confidence,
      variantLabel: label.confidence,
      attributes: attrs.confidence,
      unit: round(unit.confidence * nu.confidence),
      costPrice: cost.confidence,
      sellPrice: sell.confidence,
      currency: round(cur.confidence * nc.confidence),
    };

    const payload = {
      name: name.value,
      label: label.value ?? name.value,
      attributes: safeAttrs(attrs.value),
      unit: nu.value,
      costPrice: cost.value,
      sellPrice: sell.value,
      currency: nc.value,
    };

    const reviews = buildReviews(raw, fields, {
      unit: nu.value, currency: nc.value,
    });
    return { rowIndex: i, payload, reviews, needsReview: reviews.length > 0 };
  });
  return { docType: "product_list", header: {}, rows, notes: result.notes ?? [] };
}

function resolveSales(result: ExtractionResult, cat: Catalogue): ResolvedDoc {
  const { header, reviews: headerReviews } = resolveHeader(result, cat);

  const rows: ResolvedRow[] = result.rows.map((raw, i) => {
    const product = F(raw.product);
    const qty = F(raw.qty);
    const unitPrice = F(raw.unitPrice);
    const total = F(raw.total);
    const pay = F(raw.paymentMethod);

    const match = product.value ? bestMatch(String(product.value), cat.variants) : null;
    const accepted = match && match.score >= MATCH_SUGGEST;
    const matchConfidence = round(product.confidence * (match ? Math.min(1, 0.4 + match.score) : 0.3));

    // Cross-check qty*unitPrice vs stated total to catch arithmetic mis-reads.
    let totalConf = total.confidence;
    if (qty.value != null && unitPrice.value != null && total.value != null) {
      const expected = Number(qty.value) * Number(unitPrice.value);
      if (expected > 0 && Math.abs(expected - Number(total.value)) / expected > 0.02) {
        totalConf = Math.min(totalConf, 0.5); // mismatch → review
      }
    }

    const fields: Record<string, number> = {
      product: matchConfidence,
      qty: qty.confidence,
      unitPrice: unitPrice.confidence,
      total: totalConf,
      paymentMethod: pay.confidence,
    };

    const payload = {
      variantId: accepted ? match!.id : null,
      variantLabel: accepted ? match!.label : null,
      productRaw: product.value,
      matchScore: match?.score ?? 0,
      sellingPointId: header.sellingPointId ?? null,
      sellingPointName: header.sellingPointName ?? null,
      date: header.date ?? null,
      qty: qty.value,
      unitPrice: unitPrice.value,
      total: total.value ?? (qty.value != null && unitPrice.value != null ? Number(qty.value) * Number(unitPrice.value) : null),
      paymentMethod: pay.value,
      currency: "AMD",
    };

    const reviews = buildReviews(raw, fields, {
      product: accepted ? match!.label : (match ? `?: ${match.label} (${match.score})` : "new product"),
    });
    // Surface header uncertainty on the first row so the owner sees it in queue.
    if (i === 0) reviews.push(...headerReviews);
    return { rowIndex: i, payload, reviews, needsReview: reviews.length > 0 };
  });

  return { docType: "sales_sheet", header, rows, notes: result.notes ?? [] };
}

function resolveExpenses(result: ExtractionResult): ResolvedDoc {
  const rows: ResolvedRow[] = result.rows.map((raw, i) => {
    const date = F(raw.date);
    const cat = F(raw.category);
    const vendor = F(raw.vendor);
    const amount = F(raw.amount);
    const cur = F(raw.currency);

    const nd = normalizeDate(date.value);
    const ncat = normalizeCategory(cat.value);
    const ncur = normalizeCurrency(cur.value);

    const fields: Record<string, number> = {
      date: round(date.confidence * nd.confidence),
      category: round(cat.confidence * ncat.confidence),
      vendor: vendor.confidence,
      amount: amount.confidence,
      currency: round(cur.confidence * ncur.confidence),
    };
    const payload = {
      date: nd.value,
      category: ncat.value,
      vendor: vendor.value,
      amount: amount.value,
      currency: ncur.value,
    };
    const reviews = buildReviews(raw, fields, { date: nd.value, category: ncat.value, currency: ncur.value });
    return { rowIndex: i, payload, reviews, needsReview: reviews.length > 0 };
  });
  return { docType: "expense", header: {}, rows, notes: result.notes ?? [] };
}

function resolveStock(result: ExtractionResult, cat: Catalogue): ResolvedDoc {
  const { header, reviews: headerReviews } = resolveHeader(result, cat);
  const rows: ResolvedRow[] = result.rows.map((raw, i) => {
    const product = F(raw.product);
    const qty = F(raw.qtyOnHand);
    const unit = F(raw.unit);

    const match = product.value ? bestMatch(String(product.value), cat.variants) : null;
    const accepted = match && match.score >= MATCH_SUGGEST;
    const matchConfidence = round(product.confidence * (match ? Math.min(1, 0.4 + match.score) : 0.3));
    const nu = normalizeUnit(unit.value);

    const fields: Record<string, number> = {
      product: matchConfidence,
      qtyOnHand: qty.confidence,
      unit: round(unit.confidence * nu.confidence),
    };
    const payload = {
      variantId: accepted ? match!.id : null,
      variantLabel: accepted ? match!.label : null,
      productRaw: product.value,
      sellingPointId: header.sellingPointId ?? null,
      sellingPointName: header.sellingPointName ?? null,
      date: header.date ?? null,
      qtyOnHand: qty.value,
      unit: nu.value,
    };
    const reviews = buildReviews(raw, fields, { product: accepted ? match!.label : "new product", unit: nu.value });
    if (i === 0) reviews.push(...headerReviews);
    return { rowIndex: i, payload, reviews, needsReview: reviews.length > 0 };
  });
  return { docType: "stock_count", header, rows, notes: result.notes ?? [] };
}

// Emit a ReviewDraft for any field whose effective confidence is below the
// threshold. `suggestions` overrides the suggested value for resolved fields.
function buildReviews(
  raw: Record<string, any>,
  fields: Record<string, number>,
  suggestions: Record<string, any> = {},
): ReviewDraft[] {
  const out: ReviewDraft[] = [];
  for (const [field, conf] of Object.entries(fields)) {
    if (conf >= THRESHOLD) continue;
    const f = F(raw[field]);
    out.push({
      field,
      rawValue: f.raw ?? (f.value == null ? null : String(f.value)),
      suggestedValue: suggestions[field] != null ? String(suggestions[field]) : f.value == null ? null : String(f.value),
      confidence: round(conf),
      crop: f.crop ?? null,
    });
  }
  return out;
}

function safeAttrs(v: any): Record<string, any> {
  if (v == null) return {};
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return { note: String(v) };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
