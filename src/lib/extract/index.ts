import type { Extractor } from "./types";
import { MockExtractor } from "./mock";
import { ClaudeExtractor } from "./claude";

// Selects the extraction backend. Claude when a key is present (and not forced
// to mock), otherwise the deterministic mock so the app always runs.
export function getExtractor(): Extractor {
  const forced = process.env.EXTRACTOR;
  const key = process.env.ANTHROPIC_API_KEY;
  if (forced === "mock" || !key) return new MockExtractor();
  if (forced === "claude" || key) return new ClaudeExtractor(key);
  return new MockExtractor();
}

export * from "./types";
