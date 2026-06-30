import { z } from "zod";

// Every extracted field carries its own confidence (per-field, not per-page —
// Part C), the raw text the model read, and an optional crop box (image
// fractions) so the review screen can show the exact region beside the value.
export const CropBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type CropBox = z.infer<typeof CropBox>;

export const Field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    raw: z.string().optional(),
    crop: CropBox.optional(),
  });

// Concrete field aliases (zod can't easily express a generic at runtime).
const StrField = Field(z.string());
const NumField = Field(z.number());

export const DocType = z.enum([
  "product_list",
  "sales_sheet",
  "expense",
  "stock_count",
  "unknown",
]);
export type DocType = z.infer<typeof DocType>;

// ---- per-doc-type row shapes -------------------------------------------------

export const ProductRow = z.object({
  name: StrField,
  variantLabel: StrField,
  attributes: StrField, // JSON-ish or freeform e.g. "color: blue"
  unit: StrField,
  costPrice: NumField,
  sellPrice: NumField,
  currency: StrField,
});

export const SalesRow = z.object({
  product: StrField,
  qty: NumField,
  unitPrice: NumField,
  total: NumField,
  paymentMethod: StrField,
});

export const ExpenseRow = z.object({
  date: StrField,
  category: StrField,
  vendor: StrField,
  amount: NumField,
  currency: StrField,
});

export const StockRow = z.object({
  product: StrField,
  qtyOnHand: NumField,
  unit: StrField,
});

// A document's header context (date, location) — resolves ambiguous rows.
export const DocHeader = z.object({
  date: StrField.optional(),
  sellingPoint: StrField.optional(),
});

export const ExtractionResult = z.object({
  docType: DocType,
  docTypeConfidence: z.number().min(0).max(1),
  header: DocHeader.default({}),
  rows: z.array(z.record(z.any())), // validated per-doc-type by the caller
  notes: z.array(z.string()).default([]), // model-surfaced caveats (crossed-out, etc.)
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

export interface ExtractInput {
  imageUrl: string; // data URL or remote URL
  imageBase64?: string; // raw base64 (no prefix) when available
  mediaType?: string; // image/jpeg, image/png
  docTypeHint?: DocType; // user override
  fewShot?: { field: string; rawValue: string; corrected: string }[];
  // a stable key (e.g. image hash) so the mock extractor is deterministic
  seed?: string;
}

export interface Extractor {
  readonly name: string;
  extract(input: ExtractInput): Promise<ExtractionResult>;
}
