"use client";

import { useEffect, useState, useCallback } from "react";
import { RevenueArea, BarSeries, PopularVsProfit } from "@/components/Charts";
import { money, moneyFull, num, trendLabel } from "@/lib/format";

type Metrics = any;

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [cat, setCat] = useState<any>(null);
  const [sellingPointId, setSellingPointId] = useState("");
  const [range, setRange] = useState("30");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - (Number(range) - 1) * 86400000);
    const qs = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    if (sellingPointId) qs.set("sellingPointId", sellingPointId);
    const [m, c] = await Promise.all([
      fetch(`/api/metrics?${qs}`).then((r) => r.json()),
      cat ? Promise.resolve(cat) : fetch("/api/catalogue").then((r) => r.json()),
    ]);
    setMetrics(m);
    setCat(c);
    setLoading(false);
  }, [range, sellingPointId, cat]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, sellingPointId]);

  if (!metrics) {
    return <div className="py-20 text-center text-muted">{loading ? "Loading metrics…" : "No data yet."}</div>;
  }

  const h = metrics.hero;
  const empty = h.revenue.value === 0 && h.unitsSold.value === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Business dashboard</h1>
          <p className="text-sm text-muted">
            {metrics.window.from} → {metrics.window.to} · {metrics.window.days} days
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" value={sellingPointId} onChange={(e) => setSellingPointId(e.target.value)}>
            <option value="">All locations</option>
            {cat?.sellingPoints?.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
        </div>
      </div>

      {empty && (
        <div className="card border-warn/40 bg-warn/5 text-sm">
          No sales in this window yet. Go to <a className="text-accent" href="/capture">Capture</a> to snap a price list and a
          sales sheet — the dashboard fills in as pages are committed.
        </div>
      )}

      {/* HERO ROW — the 8 that earn the top of the screen */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi title="Net profit" value={moneyFull(h.netProfit.value)} trend={h.netProfit.trend} primary />
        <Kpi title="Revenue" value={moneyFull(h.revenue.value)} trend={h.revenue.trend} />
        <Kpi title="Gross margin" value={`${h.grossMarginPct.value}%`} hint="Revenue − COGS" />
        <Kpi
          title="Units sold"
          value={num(h.unitsSold.value)}
          hint={h.unitsSold.bestSeller ? `Best: ${h.unitsSold.bestSeller.label} (${h.unitsSold.bestSeller.units})` : undefined}
        />
        <Kpi
          title="Most profitable"
          value={h.mostProfitable ? h.mostProfitable.label : "—"}
          hint={h.mostProfitable ? `${moneyFull(h.mostProfitable.contribution)} · ${h.mostProfitable.marginPct}% margin` : "the killer insight"}
        />
        <Kpi title="Stock value" value={moneyFull(h.stockValue.cost)} hint={`${moneyFull(h.stockValue.retail)} at retail`} />
        <Kpi
          title="Reorder now"
          value={num(h.reorderNow.value)}
          hint={h.reorderNow.value > 0 ? h.reorderNow.items.map((i: any) => i.label).slice(0, 2).join(", ") : "all healthy"}
          tone={h.reorderNow.value > 0 ? "warn" : "good"}
        />
        <Kpi title="Expense burn" value={moneyFull(h.expenseBurn.value)} trend={h.expenseBurn.trend} invertTrend />
      </section>

      {/* CHARTS */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Revenue by day</h2>
            <span className="label">avg sale {moneyFull(metrics.salesDemand.avgSaleValue)}</span>
          </div>
          <RevenueArea data={metrics.salesDemand.revenueByDay} />
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">Popular vs profitable</h2>
          <p className="mb-2 text-xs text-muted">Bubble size = margin %. Top-right wins on both.</p>
          <PopularVsProfit data={metrics.profitability.contributionByVariant.map((v: any) => ({ label: v.label, units: v.units, contribution: v.contribution, marginPct: v.marginPct }))} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-medium">Revenue by location</h2>
          <BarSeries data={metrics.salesDemand.revenueByPoint} />
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">Expenses by category</h2>
          <BarSeries data={metrics.expensesCash.byCategory} color="#f87171" />
        </div>
      </section>

      {/* INVENTORY + REORDER */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-medium">Days of cover — reorder soonest first</h2>
          <table className="data">
            <thead>
              <tr><th>Variant</th><th>Location</th><th>On hand</th><th>Velocity</th><th>Days cover</th></tr>
            </thead>
            <tbody>
              {metrics.inventory.byVariant.slice(0, 8).map((s: any, i: number) => (
                <tr key={i}>
                  <td>{s.label}</td>
                  <td className="text-muted">{s.sellingPoint}</td>
                  <td>{num(s.qtyOnHand)}</td>
                  <td>{s.velocity}/d</td>
                  <td>
                    <span className={`pill ${coverTone(s.daysOfCover)}`}>{isFinite(s.daysOfCover) ? `${s.daysOfCover}d` : "—"}</span>
                  </td>
                </tr>
              ))}
              {metrics.inventory.byVariant.length === 0 && <tr><td colSpan={5} className="text-muted">No stock recorded.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">Raw materials — days until out</h2>
          <table className="data">
            <thead>
              <tr><th>Material</th><th>On hand</th><th>Rate/day</th><th>Days left</th></tr>
            </thead>
            <tbody>
              {metrics.rawMaterials.materials.map((m: any, i: number) => (
                <tr key={i}>
                  <td>{m.name}</td>
                  <td>{num(m.qtyOnHand)} {m.unit}</td>
                  <td>{m.ratePerDay}</td>
                  <td><span className={`pill ${m.daysUntilOut != null && m.daysUntilOut < 14 ? "bg-warn/20 text-warn" : "bg-good/15 text-good"}`}>{m.daysUntilOut != null ? `${m.daysUntilOut}d` : "—"}</span></td>
                </tr>
              ))}
              {metrics.rawMaterials.materials.length === 0 && <tr><td colSpan={4} className="text-muted">No materials recorded.</td></tr>}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Material cost = {moneyFull(metrics.rawMaterials.materialCost)} ({metrics.rawMaterials.materialCostPctRevenue}% of revenue)</p>
        </div>
      </section>

      {/* DEAD STOCK + HEALTH */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <h2 className="mb-3 font-medium">Dead stock</h2>
          {metrics.inventory.deadStock.length === 0 ? (
            <p className="text-sm text-muted">Nothing idle — every stocked variant has recent movement.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {metrics.inventory.deadStock.map((d: any, i: number) => (
                <li key={i} className="flex justify-between">
                  <span>{d.label} <span className="text-muted">@ {d.sellingPoint}</span></span>
                  <span className="text-bad">{moneyFull(d.tiedCash)} tied</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">Best & slow movers</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="label mb-1">Best</p>
              {metrics.salesDemand.bestSellers.slice(0, 4).map((b: any, i: number) => <div key={i} className="flex justify-between"><span className="truncate">{b.label}</span><span className="text-good">{b.units}</span></div>)}
            </div>
            <div>
              <p className="label mb-1">Slow</p>
              {metrics.salesDemand.slowMovers.slice(0, 4).map((b: any, i: number) => <div key={i} className="flex justify-between"><span className="truncate">{b.label}</span><span className="text-muted">{b.units}</span></div>)}
            </div>
          </div>
        </div>
        <div className="card">
          <h2 className="mb-3 font-medium">System health</h2>
          <Health label="Data coverage" value={`${metrics.systemHealth.dataCoverage}%`} sub={`${metrics.systemHealth.digitizedDays}/${metrics.systemHealth.windowDays} days digitized`} />
          <Health label="Auto-approved rows" value={num(metrics.systemHealth.autoApprovedRows)} sub="committed with no human touch" />
          <Health label="Inventory turnover" value={metrics.inventory.inventoryTurnover ?? "—"} sub="COGS ÷ stock at cost" />
          <p className="mt-2 text-xs text-muted">Every number drills down to a source photo. {loading ? "Refreshing…" : ""}</p>
        </div>
      </section>
    </div>
  );
}

function Kpi({ title, value, trend, hint, primary, tone, invertTrend }: { title: string; value: string; trend?: number | null; hint?: string; primary?: boolean; tone?: "good" | "warn" | "bad"; invertTrend?: boolean }) {
  const t = trend !== undefined ? trendLabel(trend) : null;
  // For expense burn, a rise is bad — flip the tone.
  const tclass = t ? (t.tone === "muted" ? "text-muted" : (invertTrend ? (t.tone === "good" ? "text-bad" : "text-good") : (t.tone === "good" ? "text-good" : "text-bad"))) : "";
  return (
    <div className={`card ${primary ? "border-accent/40 bg-accent/5" : ""}`}>
      <div className="label">{title}</div>
      <div className={`kpi-value mt-1 ${tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      {t && <div className={`mt-1 text-xs ${tclass}`}>{t.text}</div>}
      {hint && !t && <div className="mt-1 truncate text-xs text-muted">{hint}</div>}
      {hint && t && <div className="mt-0.5 truncate text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Health({ label, value, sub }: { label: string; value: any; sub: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function coverTone(days: number): string {
  if (!isFinite(days)) return "bg-edge text-muted";
  if (days < 7) return "bg-bad/20 text-bad";
  if (days < 14) return "bg-warn/20 text-warn";
  return "bg-good/15 text-good";
}
