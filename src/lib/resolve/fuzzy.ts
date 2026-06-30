// Lightweight fuzzy matcher for entity resolution (layer [4]): map a scribbled
// product name to a canonical variant. No dependencies — combines a normalized
// Levenshtein ratio with token-set overlap, which handles word reordering and
// extra attribute words ("Marash blue pendant" vs "Marash pendant — blue").

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[—–-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

function levRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  // Weight token overlap a bit higher — robust to reordering and noise words.
  return 0.45 * levRatio(na, nb) + 0.55 * tokenSetRatio(na, nb);
}

export interface MatchCandidate {
  id: string;
  label: string;
  aliases?: string[];
}

export interface MatchResult {
  id: string;
  label: string;
  score: number; // 0..1
  runnerUp?: { id: string; label: string; score: number };
}

export function bestMatch(query: string, candidates: MatchCandidate[]): MatchResult | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((c) => {
      const texts = [c.label, ...(c.aliases ?? [])];
      const score = Math.max(...texts.map((t) => similarity(query, t)));
      return { c, score };
    })
    .sort((x, y) => y.score - x.score);

  const top = scored[0];
  const runner = scored[1];
  return {
    id: top.c.id,
    label: top.c.label,
    score: round(top.score),
    runnerUp: runner ? { id: runner.c.id, label: runner.c.label, score: round(runner.score) } : undefined,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
