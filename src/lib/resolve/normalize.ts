// Value normalization (layer [4]): dates, units, currency. Each returns the
// normalized value plus a confidence multiplier reflecting how sure the mapping
// is, so genuinely ambiguous values still get routed to review.

export interface Normalized<T> {
  value: T | null;
  confidence: number; // multiplier in [0,1] applied to the field's own confidence
  note?: string;
}

const WEEKDAYS: Record<string, number> = {
  // English (incl. common abbreviations)
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
  // Armenian
  կիրակի: 0, երկուշաբթի: 1, երեքշաբթի: 2, երեք: 2, չորեքշաբթի: 3,
  հինգշաբթի: 4, ուրբաթ: 5, շաբաթ: 6,
};

// Resolve a date using page context (header date) when the cell is just a
// weekday ("Tues") — the spec's example. Returns ISO yyyy-mm-dd.
export function normalizeDate(raw: string | null | undefined, contextISO?: string): Normalized<string> {
  if (!raw) return { value: null, confidence: 0 };
  const s = raw.trim();

  // Already ISO?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { value: s, confidence: 1 };

  // dd/mm/yyyy or dd.mm.yyyy or dd-mm-yy
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    let year = y.length === 2 ? Number(`20${y}`) : Number(y);
    const dd = String(Number(d)).padStart(2, "0");
    const mm = String(Number(m)).padStart(2, "0");
    return { value: `${year}-${mm}-${dd}`, confidence: 0.95 };
  }

  // Weekday + context → nearest such weekday on/before the context date.
  const wd = WEEKDAYS[s.toLowerCase()];
  if (wd !== undefined && contextISO) {
    const ctx = new Date(`${contextISO}T00:00:00Z`);
    if (!isNaN(ctx.getTime())) {
      const delta = (ctx.getUTCDay() - wd + 7) % 7;
      const d = new Date(ctx);
      d.setUTCDate(d.getUTCDate() - delta);
      return { value: d.toISOString().slice(0, 10), confidence: 0.8, note: `resolved "${raw}" via page context` };
    }
  }
  if (wd !== undefined) {
    return { value: null, confidence: 0.4, note: `weekday "${raw}" needs a reference date` };
  }
  return { value: null, confidence: 0.2, note: `unrecognized date "${raw}"` };
}

const UNIT_MAP: Record<string, string> = {
  pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", հատ: "pcs",
  pair: "pair", pairs: "pair", զույգ: "pair",
  g: "g", gr: "g", gram: "g", grams: "g", գ: "g", գր: "g",
  kg: "kg", կգ: "kg",
  ml: "ml", l: "l", litre: "l", liter: "l",
  m: "m", cm: "cm",
};

export function normalizeUnit(raw: string | null | undefined): Normalized<string> {
  if (!raw) return { value: "pcs", confidence: 0.5, note: "defaulted to pcs" };
  const key = raw.trim().toLowerCase();
  const mapped = UNIT_MAP[key];
  if (mapped) return { value: mapped, confidence: 1 };
  return { value: null, confidence: 0.4, note: `ambiguous unit "${raw}"` };
}

const CURRENCY_MAP: Record<string, string> = {
  amd: "AMD", "֏": "AMD", "դր": "AMD", "դրամ": "AMD", dram: "AMD",
  eur: "EUR", "€": "EUR", euro: "EUR",
  usd: "USD", $: "USD", dollar: "USD",
  rub: "RUB", "₽": "RUB",
};

export function normalizeCurrency(raw: string | null | undefined): Normalized<string> {
  if (!raw) return { value: "AMD", confidence: 0.6, note: "defaulted to AMD" };
  const key = raw.trim().toLowerCase();
  const mapped = CURRENCY_MAP[key];
  if (mapped) return { value: mapped, confidence: 1 };
  return { value: "AMD", confidence: 0.5, note: `unknown currency "${raw}", assumed AMD` };
}

const EXPENSE_CATEGORIES = ["rent", "wages", "transport", "packaging", "fees", "materials", "other"];

export function normalizeCategory(raw: string | null | undefined): Normalized<string> {
  if (!raw) return { value: "other", confidence: 0.5 };
  const key = raw.trim().toLowerCase();
  if (EXPENSE_CATEGORIES.includes(key)) return { value: key, confidence: 1 };
  // soft contains match
  const hit = EXPENSE_CATEGORIES.find((c) => key.includes(c) || c.includes(key));
  if (hit) return { value: hit, confidence: 0.8 };
  return { value: "other", confidence: 0.6, note: `mapped "${raw}" → other` };
}
