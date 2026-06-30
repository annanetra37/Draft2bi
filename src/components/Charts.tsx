"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const AXIS = { stroke: "#8b97a8", fontSize: 11 };
const GRID = "#26303f";
const ACCENT = "#4f9cf9";

export function RevenueArea({ data }: { data: { date: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.5} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
        <YAxis tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} width={42} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#cbd5e1" }} />
        <Area type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarSeries({ data, color = ACCENT, height = 220 }: { data: { name: string; value: number }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={color} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Most-popular vs most-profitable — the spec's "killer insight" plot.
export function PopularVsProfit({ data }: { data: { label: string; units: number; contribution: number; marginPct: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="units" name="Units" tick={AXIS} label={{ value: "Units sold", position: "insideBottom", offset: -6, fill: "#8b97a8", fontSize: 11 }} />
        <YAxis type="number" dataKey="contribution" name="Profit" tick={AXIS} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} width={46} />
        <ZAxis type="number" dataKey="marginPct" range={[60, 400]} name="Margin%" />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ strokeDasharray: "3 3" }}
          formatter={(val: any, name: any) => [val, name]}
          labelFormatter={() => ""}
          content={<ScatterTip />}
        />
        <Scatter data={data} fill={ACCENT}>
          {data.map((_, i) => (
            <Cell key={i} fill={["#4f9cf9", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#f87171"][i % 6]} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function ScatterTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={tooltipStyle as any} className="text-xs">
      <div className="font-semibold">{p.label}</div>
      <div>{p.units} units</div>
      <div>{Math.round(p.contribution).toLocaleString()} profit</div>
      <div>{p.marginPct}% margin</div>
    </div>
  );
}

const tooltipStyle = {
  background: "#141b26",
  border: "1px solid #26303f",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 12,
};
