export function money(n: number | null | undefined, currency = "AMD"): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const compact = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : abs >= 10_000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;
  return `${compact} ${currency}`;
}

export function moneyFull(n: number | null | undefined, currency = "AMD"): string {
  if (n == null) return "—";
  return `${new Intl.NumberFormat("en-US").format(Math.round(n))} ${currency}`;
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function trendLabel(pct: number | null | undefined): { text: string; tone: "good" | "bad" | "muted" } {
  if (pct == null) return { text: "no prior data", tone: "muted" };
  if (pct === 0) return { text: "flat", tone: "muted" };
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(pct)}% vs prior`, tone: up ? "good" : "bad" };
}
