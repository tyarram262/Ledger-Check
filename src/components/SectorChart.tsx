"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { SectorSlice } from "@/lib/concentration";
import { formatUsd } from "@/lib/format";

const SECTOR_COLORS: Record<string, string> = {
  "Information Technology": "#6366f1",
  "Communication Services": "#8b5cf6",
  "Consumer Discretionary": "#ec4899",
  "Consumer Staples": "#f59e0b",
  Financials: "#10b981",
  "Health Care": "#ef4444",
  Energy: "#f97316",
  Industrials: "#64748b",
  Materials: "#a16207",
  Utilities: "#0ea5e9",
  "Real Estate": "#14b8a6",
  Diversified: "#94a3b8",
  "Fixed Income": "#475569",
  Commodities: "#eab308",
  Unmapped: "#d1d5db",
};

export function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? "#d1d5db";
}

export default function SectorChart({ slices }: { slices: SectorSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="sector"
          innerRadius={70}
          outerRadius={110}
          paddingAngle={2}
          strokeWidth={0}
        >
          {slices.map((s) => (
            <Cell key={s.sector} fill={sectorColor(s.sector)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [formatUsd(Number(value ?? 0)), name]}
        />
        <Legend
          formatter={(value: string) => {
            const slice = slices.find((s) => s.sector === value);
            return slice ? `${value} (${slice.pct.toFixed(1)}%)` : value;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
