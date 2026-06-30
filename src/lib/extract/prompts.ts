import type { DocType } from "./types";

// Strict, per-doc-type instructions. The model must return ONLY JSON matching
// the shape in src/lib/extract/types.ts, with a confidence in [0,1] on EVERY
// field (per-field, not per-page) and a crop box when it can localise the value.

const SHARED = `
You are PaperLens, reading a photographed page from a small business that keeps
records by hand. The handwriting may be Armenian, English, or mixed, and may use
Armenian numerals — treat multilingual reading as a first-class requirement.

Rules:
- Return ONLY a single JSON object. No markdown, no commentary.
- Every field is an object: {"value": <typed value or null>, "confidence": <0..1>, "raw": "<verbatim text you read>", "crop": {"x","y","w","h"}}.
  Coordinates are fractions of the image (0..1). Omit "crop" if you cannot localise it.
- confidence is YOUR calibrated certainty for THAT field alone. Be honest: smudged,
  ambiguous, or inferred values must score low so a human reviews them.
- Handle messy reality: ignore crossed-out lines (mention them in "notes"), do not
  invent rows, split "two products on one line" into two rows, and keep margin totals
  out of the rows (put them in "notes").
- Numbers: strip thousands separators and currency symbols; "value" must be numeric.
`;

const SCHEMAS: Record<Exclude<DocType, "unknown">, string> = {
  product_list: `
This is a product / price list. It seeds the catalogue.
Shape:
{
  "docType": "product_list",
  "docTypeConfidence": <0..1>,
  "header": {},
  "notes": [<string>],
  "rows": [{
    "name": Field<string>,          // base product, e.g. "Marash pendant"
    "variantLabel": Field<string>,  // full variant label incl. attributes
    "attributes": Field<string>,    // JSON like {"color":"blue","size":"M"} when present
    "unit": Field<string>,          // pcs | pair | g | ml | ...
    "costPrice": Field<number>,
    "sellPrice": Field<number>,
    "currency": Field<string>       // AMD | EUR | USD
  }]
}`,
  sales_sheet: `
This is a daily sales sheet for one selling point.
Shape:
{
  "docType": "sales_sheet",
  "docTypeConfidence": <0..1>,
  "header": { "date": Field<string>, "sellingPoint": Field<string> },
  "notes": [<string>],
  "rows": [{
    "product": Field<string>,       // as written; resolution happens downstream
    "qty": Field<number>,
    "unitPrice": Field<number>,
    "total": Field<number>,
    "paymentMethod": Field<string>  // cash | card | transfer
  }]
}`,
  expense: `
This is an expense note or receipt.
Shape:
{
  "docType": "expense",
  "docTypeConfidence": <0..1>,
  "header": {},
  "notes": [<string>],
  "rows": [{
    "date": Field<string>,
    "category": Field<string>,      // rent | wages | transport | packaging | fees | other
    "vendor": Field<string>,
    "amount": Field<number>,
    "currency": Field<string>
  }]
}`,
  stock_count: `
This is a raw stock / inventory count for one selling point.
Shape:
{
  "docType": "stock_count",
  "docTypeConfidence": <0..1>,
  "header": { "sellingPoint": Field<string>, "date": Field<string> },
  "notes": [<string>],
  "rows": [{
    "product": Field<string>,
    "qtyOnHand": Field<number>,
    "unit": Field<string>
  }]
}`,
};

export function buildPrompt(
  docTypeHint: DocType | undefined,
  fewShot?: { field: string; rawValue: string; corrected: string }[],
): string {
  const detect =
    docTypeHint && docTypeHint !== "unknown"
      ? `The user says this is a "${docTypeHint}". Use that unless the image clearly contradicts it.`
      : `First decide docType among product_list | sales_sheet | expense | stock_count, then extract accordingly.`;

  const schemaText =
    docTypeHint && docTypeHint !== "unknown"
      ? SCHEMAS[docTypeHint]
      : Object.values(SCHEMAS).join("\n");

  const examples =
    fewShot && fewShot.length
      ? `\nVerified human corrections from past pages (mimic these reads):\n` +
        fewShot
          .slice(0, 12)
          .map((e) => `- field "${e.field}": read "${e.rawValue}" → correct "${e.corrected}"`)
          .join("\n")
      : "";

  return `${SHARED}\n${detect}\n${schemaText}${examples}\n\nReturn the JSON now.`;
}
