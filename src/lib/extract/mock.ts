import type { Extractor, ExtractInput, ExtractionResult, DocType } from "./types";
import { FIXTURES } from "./fixtures";

// Deterministic, dependency-free extractor used when no ANTHROPIC_API_KEY is
// present. It returns a fixture matching the doc-type hint (or inferred from the
// seed), so the entire Capture → Extract → Resolve → Review → Store → Dashboard
// pipeline runs end-to-end offline and still demonstrates confidence routing.
export class MockExtractor implements Extractor {
  readonly name = "mock";

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const docType = input.docTypeHint ?? inferFromSeed(input.seed) ?? "product_list";
    const fixture = FIXTURES[docType] ?? FIXTURES.product_list;
    // Deep clone so callers can mutate freely without poisoning the fixture.
    return structuredClone(fixture);
  }
}

function inferFromSeed(seed?: string): DocType | undefined {
  if (!seed) return undefined;
  const s = seed.toLowerCase();
  if (s.includes("price") || s.includes("product") || s.includes("catalog")) return "product_list";
  if (s.includes("sale")) return "sales_sheet";
  if (s.includes("expense") || s.includes("receipt")) return "expense";
  if (s.includes("stock") || s.includes("count")) return "stock_count";
  return undefined;
}
