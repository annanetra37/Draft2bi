import { prisma } from "@/lib/db";

// Metrics engine (layer [7]) — computes the full Part D catalogue over any
// date / selling-point / product / category filter. At demo scale we aggregate
// in TypeScript; the same shapes map cleanly onto Postgres materialized views
// for production.

export interface MetricFilters {
  from?: string; // ISO date inclusive
  to?: string; // ISO date inclusive
  sellingPointId?: string;
  productId?: string;
  category?: string;
}

const DAY = 86400000;

function windowOf(filters: MetricFilters) {
  const to = filters.to ? new Date(`${filters.to}T23:59:59Z`) : new Date();
  const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : new Date(to.getTime() - 29 * DAY);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY) + 1);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * DAY);
  return { from, to, days, prevFrom, prevTo };
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null; // null = "no prior baseline"
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export async function getMetrics(filters: MetricFilters = {}) {
  const { from, to, days, prevFrom, prevTo } = windowOf(filters);

  const saleWhere: any = { date: { gte: from, lte: to } };
  if (filters.sellingPointId) saleWhere.sellingPointId = filters.sellingPointId;
  if (filters.productId) saleWhere.variant = { productId: filters.productId };

  const [sales, prevSales, expenses, prevExpenses, variants, stock, rawMaterials, images, movements] = await Promise.all([
    prisma.sale.findMany({ where: saleWhere, include: { variant: { include: { product: true } }, sellingPoint: true } }),
    prisma.sale.findMany({ where: { ...saleWhere, date: { gte: prevFrom, lte: prevTo } }, include: { variant: true } }),
    prisma.expense.findMany({ where: { date: { gte: from, lte: to }, ...(filters.category ? { category: filters.category } : {}) } }),
    prisma.expense.findMany({ where: { date: { gte: prevFrom, lte: prevTo } } }),
    prisma.variant.findMany({ include: { product: true } }),
    prisma.stock.findMany({ include: { variant: { include: { product: true } }, sellingPoint: true } }),
    prisma.rawMaterial.findMany(),
    prisma.sourceImage.findMany(),
    prisma.stockMovement.findMany({ where: { date: { gte: from, lte: to } } }),
  ]);

  const variantById = new Map(variants.map((v) => [v.id, v]));

  // ---- core sums --------------------------------------------------------
  const revenue = sum(sales.map((s) => s.total));
  const prevRevenue = sum(prevSales.map((s) => s.total));
  const cogs = sum(sales.map((s) => (variantById.get(s.variantId)?.costPrice ?? 0) * s.qty));
  const expenseTotal = sum(expenses.map((e) => e.amount));
  const prevExpenseTotal = sum(prevExpenses.map((e) => e.amount));
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenseTotal;
  const prevNet = prevRevenue - sum(prevSales.map((s) => (variantById.get(s.variantId)?.costPrice ?? 0) * s.qty)) - prevExpenseTotal;
  const unitsSold = sum(sales.map((s) => s.qty));

  // ---- per-variant rollup ----------------------------------------------
  const byVariant = new Map<string, { id: string; label: string; product: string; units: number; revenue: number; cogs: number }>();
  for (const s of sales) {
    const v = variantById.get(s.variantId);
    const key = s.variantId;
    const cur = byVariant.get(key) ?? { id: key, label: v?.label ?? "?", product: v?.product.name ?? "?", units: 0, revenue: 0, cogs: 0 };
    cur.units += s.qty;
    cur.revenue += s.total;
    cur.cogs += (v?.costPrice ?? 0) * s.qty;
    byVariant.set(key, cur);
  }
  const variantRows = [...byVariant.values()].map((r) => ({
    ...r,
    contribution: r.revenue - r.cogs,
    marginPct: r.revenue ? Math.round(((r.revenue - r.cogs) / r.revenue) * 1000) / 10 : 0,
    velocity: Math.round((r.units / days) * 100) / 100,
  }));

  const bestSeller = [...variantRows].sort((a, b) => b.units - a.units)[0] ?? null;
  const mostProfitable = [...variantRows].sort((a, b) => b.contribution - a.contribution)[0] ?? null;

  // ---- stock value + reorder-now ---------------------------------------
  const stockValueCost = sum(stock.map((s) => s.qtyOnHand * s.variant.costPrice));
  const stockValueRetail = sum(stock.map((s) => s.qtyOnHand * s.variant.sellPrice));

  const REORDER_DAYS = 7;
  const DEAD_DAYS = 21;
  const velocityByVariant = new Map(variantRows.map((r) => [r.id, r.velocity]));
  const stockRows = stock.map((s) => {
    const vel = velocityByVariant.get(s.variantId) ?? 0;
    const daysOfCover = vel > 0 ? Math.round((s.qtyOnHand / vel) * 10) / 10 : Infinity;
    return {
      variantId: s.variantId,
      label: s.variant.label,
      sellingPoint: s.sellingPoint.name,
      qtyOnHand: s.qtyOnHand,
      velocity: vel,
      daysOfCover,
      valueCost: s.qtyOnHand * s.variant.costPrice,
    };
  });
  const reorderNow = stockRows.filter((s) => isFinite(s.daysOfCover) && s.daysOfCover < REORDER_DAYS && s.velocity > 0);
  const soldVariantIds = new Set(sales.map((s) => s.variantId));
  const deadStock = stockRows.filter((s) => s.qtyOnHand > 0 && !soldVariantIds.has(s.variantId));

  // ---- drill-down series ------------------------------------------------
  const revenueByDay = bucketByDay(sales, from, days);
  const revenueByPoint = groupSum(sales, (s) => s.sellingPoint?.name ?? "Unassigned", (s) => s.total);
  const marginByPoint = groupAgg(
    sales,
    (s) => s.sellingPoint?.name ?? "Unassigned",
    (s) => ({ rev: s.total, cogs: (variantById.get(s.variantId)?.costPrice ?? 0) * s.qty }),
  ).map((g) => ({ name: g.key, revenue: g.rev, marginPct: g.rev ? Math.round(((g.rev - g.cogs) / g.rev) * 1000) / 10 : 0 }));
  const revenueByCategory = groupSum(sales, (s) => variantById.get(s.variantId)?.product.category ?? "Uncategorized", (s) => s.total);
  const expensesByCategory = groupSum(expenses, (e) => e.category, (e) => e.amount);

  // sell-through = sold / (sold + on hand)
  const onHandByVariant = new Map<string, number>();
  for (const s of stock) onHandByVariant.set(s.variantId, (onHandByVariant.get(s.variantId) ?? 0) + s.qtyOnHand);
  const sellThrough = variantRows.map((r) => {
    const onHand = onHandByVariant.get(r.id) ?? 0;
    const denom = r.units + onHand;
    return { label: r.label, rate: denom ? Math.round((r.units / denom) * 1000) / 10 : 0 };
  });

  // inventory turnover ≈ COGS / avg inventory at cost (single-snapshot proxy)
  const inventoryTurnover = stockValueCost > 0 ? Math.round((cogs / stockValueCost) * 100) / 100 : null;

  // ---- raw materials ----------------------------------------------------
  const consumptionByMaterial = new Map<string, number>();
  for (const m of movements) {
    if (m.rawMaterialId && m.reason === "bom_consume") {
      consumptionByMaterial.set(m.rawMaterialId, (consumptionByMaterial.get(m.rawMaterialId) ?? 0) + Math.abs(m.qtyDelta));
    }
  }
  const materialCost = sum(
    [...consumptionByMaterial.entries()].map(([id, qty]) => {
      const mat = rawMaterials.find((r) => r.id === id);
      return (mat?.costPerUnit ?? 0) * qty;
    }),
  );
  const materials = rawMaterials.map((m) => {
    const consumed = consumptionByMaterial.get(m.id) ?? 0;
    const ratePerDay = consumed / days;
    return {
      name: m.name,
      unit: m.unit,
      qtyOnHand: m.qtyOnHand,
      ratePerDay: Math.round(ratePerDay * 100) / 100,
      daysUntilOut: ratePerDay > 0 ? Math.round((m.qtyOnHand / ratePerDay) * 10) / 10 : null,
      belowReorder: m.qtyOnHand <= m.reorderThreshold,
    };
  });

  // ---- system health ----------------------------------------------------
  const digitizedDays = new Set(sales.map((s) => s.date.toISOString().slice(0, 10))).size;
  const dataCoverage = Math.round((digitizedDays / days) * 1000) / 10;

  const allReviewItems = await prisma.reviewItem.count();
  const autoApprovedRows = await countAutoApproved();

  return {
    window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
    hero: {
      netProfit: { value: round0(netProfit), trend: pctChange(netProfit, prevNet) },
      revenue: { value: round0(revenue), trend: pctChange(revenue, prevRevenue) },
      grossMarginPct: { value: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : 0 },
      unitsSold: { value: round0(unitsSold), bestSeller: bestSeller ? { label: bestSeller.label, units: bestSeller.units } : null },
      mostProfitable: mostProfitable
        ? { label: mostProfitable.label, contribution: round0(mostProfitable.contribution), marginPct: mostProfitable.marginPct }
        : null,
      stockValue: { cost: round0(stockValueCost), retail: round0(stockValueRetail) },
      reorderNow: { value: reorderNow.length, items: reorderNow.slice(0, 8) },
      expenseBurn: { value: round0(expenseTotal), trend: pctChange(expenseTotal, prevExpenseTotal) },
    },
    profitability: {
      grossProfit: round0(grossProfit),
      grossMarginPct: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
      netProfit: round0(netProfit),
      breakEvenRevenue: grossMarginRate(revenue, cogs) > 0 ? round0((cogs * 0 + expenseTotal) / grossMarginRate(revenue, cogs)) : null,
      mostPopularVsProfitable: { mostPopular: bestSeller?.label ?? null, mostProfitable: mostProfitable?.label ?? null },
      contributionByVariant: variantRows.map((r) => ({ label: r.label, contribution: round0(r.contribution), units: r.units, marginPct: r.marginPct })).sort((a, b) => b.contribution - a.contribution),
    },
    salesDemand: {
      revenueByDay,
      revenueByPoint,
      marginByPoint,
      revenueByCategory,
      avgSaleValue: sales.length ? round0(revenue / sales.length) : 0,
      bestSellers: [...variantRows].sort((a, b) => b.units - a.units).slice(0, 5),
      slowMovers: [...variantRows].sort((a, b) => a.units - b.units).slice(0, 5),
      sellThrough,
      velocityByVariant: variantRows.map((r) => ({ label: r.label, velocity: r.velocity })),
    },
    inventory: {
      stockValueCost: round0(stockValueCost),
      stockValueRetail: round0(stockValueRetail),
      byVariant: stockRows.sort((a, b) => a.daysOfCover - b.daysOfCover),
      reorderNow,
      deadStock: deadStock.map((d) => ({ label: d.label, sellingPoint: d.sellingPoint, qtyOnHand: d.qtyOnHand, tiedCash: round0(d.valueCost) })),
      inventoryTurnover,
    },
    rawMaterials: {
      materials,
      materialCost: round0(materialCost),
      materialCostPctRevenue: revenue ? Math.round((materialCost / revenue) * 1000) / 10 : 0,
    },
    expensesCash: {
      total: round0(expenseTotal),
      byCategory: expensesByCategory,
      materialVsNonMaterial: { material: round0(cogs), nonMaterial: round0(expenseTotal) },
    },
    systemHealth: {
      dataCoverage,
      digitizedDays,
      windowDays: days,
      totalReviewItems: allReviewItems,
      autoApprovedRows,
    },
  };
}

// ---- helpers ----------------------------------------------------------------

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function round0(n: number): number {
  return Math.round(n);
}
function grossMarginRate(revenue: number, cogs: number): number {
  return revenue ? (revenue - cogs) / revenue : 0;
}

function bucketByDay<T extends { date: Date; total?: number }>(rows: { date: Date; total: number }[], from: Date, days: number) {
  const buckets: { date: string; revenue: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * DAY);
    buckets.push({ date: d.toISOString().slice(0, 10), revenue: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.date, i]));
  for (const r of rows) {
    const k = r.date.toISOString().slice(0, 10);
    const i = index.get(k);
    if (i != null) buckets[i].revenue += r.total;
  }
  return buckets.map((b) => ({ ...b, revenue: round0(b.revenue) }));
}

function groupSum<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyFn(r), (m.get(keyFn(r)) ?? 0) + valFn(r));
  return [...m.entries()].map(([name, value]) => ({ name, value: round0(value) })).sort((a, b) => b.value - a.value);
}

function groupAgg<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => { rev: number; cogs: number }) {
  const m = new Map<string, { rev: number; cogs: number }>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = m.get(k) ?? { rev: 0, cogs: 0 };
    const v = valFn(r);
    cur.rev += v.rev;
    cur.cogs += v.cogs;
    m.set(k, cur);
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v }));
}

async function countAutoApproved(): Promise<number> {
  // Rows that committed with no review item attached = auto-approved.
  const committed = await prisma.stagedRow.findMany({ where: { status: "committed" } });
  let auto = 0;
  for (const r of committed) {
    const had = await prisma.reviewItem.count({ where: { sourceImageId: r.sourceImageId, rowIndex: r.rowIndex } });
    if (had === 0) auto++;
  }
  return auto;
}
