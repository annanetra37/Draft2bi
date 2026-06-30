import type { ExtractionResult } from "./types";

// These fixtures stand in for what the vision-LLM returns from a photographed
// page. They deliberately include the "messy reality" the spec calls out:
// low-confidence Armenian handwriting, a crossed-out line, a mixed unit, and a
// margin total — so the pipeline visibly routes the right fields to review.

const f = (value: any, confidence: number, raw?: string): any => ({
  value,
  confidence,
  raw: raw ?? (value == null ? undefined : String(value)),
});

export const PRODUCT_LIST: ExtractionResult = {
  docType: "product_list",
  docTypeConfidence: 0.97,
  header: {},
  notes: ["Header row 'Ապրանք / գին' detected and skipped."],
  rows: [
    {
      name: f("Marash pendant", 0.96, "Մարաշ կախազարդ"),
      variantLabel: f("Marash pendant — blue", 0.9),
      attributes: f('{"color":"blue"}', 0.88, "կապույտ"),
      unit: f("pcs", 0.99),
      costPrice: f(3200, 0.93),
      sellPrice: f(9000, 0.95),
      currency: f("AMD", 0.99),
    },
    {
      name: f("Marash pendant", 0.96, "Մարաշ կախազարդ"),
      variantLabel: f("Marash pendant — red", 0.9),
      attributes: f('{"color":"red"}', 0.86, "կարմիր"),
      unit: f("pcs", 0.99),
      costPrice: f(3200, 0.92),
      sellPrice: f(9000, 0.95),
      currency: f("AMD", 0.99),
    },
    {
      name: f("Silver ring", 0.94, "Արծաթե մատանի"),
      variantLabel: f("Silver ring — size M", 0.78, "size ?"),
      attributes: f('{"size":"M"}', 0.62, "M/?"), // low conf → review
      unit: f("pcs", 0.99),
      costPrice: f(5400, 0.9),
      sellPrice: f(14000, 0.93),
      currency: f("AMD", 0.99),
    },
    {
      name: f("Enamel earrings", 0.95, "Արծնապակի ականջող"),
      variantLabel: f("Enamel earrings — teal", 0.88),
      attributes: f('{"color":"teal"}', 0.84),
      unit: f("pair", 0.71, "զույգ"), // unit ambiguity → review
      costPrice: f(2800, 0.91),
      sellPrice: f(7500, 0.94),
      currency: f("AMD", 0.99),
    },
  ],
};

export const SALES_SHEET_TUE: ExtractionResult = {
  docType: "sales_sheet",
  docTypeConfidence: 0.95,
  header: {
    date: f("Tues", 0.7, "Երեք"), // needs date resolution → review-able
    sellingPoint: f("Cascade", 0.92, "Կասկադ"),
  },
  notes: [
    "One line crossed out and ignored.",
    "Daily total written in the margin: 61500.",
  ],
  rows: [
    {
      product: f("Marash pendant blue", 0.9, "Մարաշ կապույտ"),
      qty: f(3, 0.95),
      unitPrice: f(9000, 0.93),
      total: f(27000, 0.9),
      paymentMethod: f("cash", 0.8),
    },
    {
      product: f("Silver ring M", 0.74, "մատանի M"), // fuzzy + low conf
      qty: f(1, 0.94),
      unitPrice: f(14000, 0.9),
      total: f(14000, 0.9),
      paymentMethod: f("card", 0.82),
    },
    {
      product: f("Enamel earrings teal", 0.88, "ականջող"),
      qty: f(2, 0.93),
      unitPrice: f(7500, 0.9),
      total: f(15000, 0.9),
      paymentMethod: f("cash", 0.6), // low conf → review
    },
    {
      product: f("Marash pendant red", 0.62, "Մարաշ ???"), // smudged → review
      qty: f(1, 0.7),
      unitPrice: f(9000, 0.88),
      total: f(9000, 0.88),
      paymentMethod: f("cash", 0.8),
    },
  ],
};

export const EXPENSE_RECEIPT: ExtractionResult = {
  docType: "expense",
  docTypeConfidence: 0.93,
  header: {},
  notes: ["Faded thermal receipt; vendor line partially legible."],
  rows: [
    {
      date: f("2026-06-22", 0.9),
      category: f("packaging", 0.82),
      vendor: f("Tara Print", 0.58, "Tar? Pr??t"), // low conf → review
      amount: f(18500, 0.92),
      currency: f("AMD", 0.99),
    },
    {
      date: f("2026-06-22", 0.9),
      category: f("transport", 0.86),
      vendor: f("GG Taxi", 0.8),
      amount: f(3200, 0.93),
      currency: f("AMD", 0.99),
    },
  ],
};

export const STOCK_COUNT: ExtractionResult = {
  docType: "stock_count",
  docTypeConfidence: 0.9,
  header: {
    sellingPoint: f("Megamall", 0.9, "Մեգամոլ"),
    date: f("2026-06-25", 0.88),
  },
  notes: [],
  rows: [
    { product: f("Marash pendant blue", 0.9), qtyOnHand: f(12, 0.92), unit: f("pcs", 0.98) },
    { product: f("Silver ring M", 0.72, "մատանի"), qtyOnHand: f(4, 0.9), unit: f("pcs", 0.98) },
    { product: f("Enamel earrings teal", 0.88), qtyOnHand: f(7, 0.9), unit: f("pair", 0.7) },
  ],
};

export const FIXTURES: Record<string, ExtractionResult> = {
  product_list: PRODUCT_LIST,
  sales_sheet: SALES_SHEET_TUE,
  expense: EXPENSE_RECEIPT,
  stock_count: STOCK_COUNT,
};
