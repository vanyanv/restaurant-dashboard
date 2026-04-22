"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { CategoryBreakdown } from "@/lib/cogs"

const SLICE_COLORS = [
  "#1a1613",
  "#3b342d",
  "#5a4f44",
  "#7a6c5c",
  "#9b8f7e",
  "#b8ad9c",
  "#c9beaf",
  "#d8cfbf",
]

export function CostByCategoryDonut({
  data,
  total,
}: {
  data: CategoryBreakdown[]
  total: number
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1.2fr]">
      <div style={{ minHeight: 220, height: 240 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="cogsDollars"
              nameKey="category"
              innerRadius="55%"
              outerRadius="85%"
              stroke="var(--paper)"
              strokeWidth={1}
              isAnimationActive
              animationDuration={600}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--hairline-bold)",
                borderRadius: 2,
                fontFamily: "var(--font-jetbrains-mono)",
                fontSize: 11,
              }}
              formatter={(value: number) => [`$${value.toFixed(0)}`, "COGS"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <table className="text-xs font-mono w-full">
        <thead>
          <tr className="border-b border-(--hairline-bold)">
            <th className="text-left py-1 font-label">Category</th>
            <th className="text-right py-1 font-label">$</th>
            <th className="text-right py-1 font-label">%</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={c.category} className="border-b border-(--hairline)">
              <td className="py-1 flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2"
                  style={{
                    background: SLICE_COLORS[i % SLICE_COLORS.length],
                  }}
                />
                <span className="font-display italic">{c.category}</span>
              </td>
              <td className="text-right py-1">${c.cogsDollars.toFixed(0)}</td>
              <td className="text-right py-1 text-(--ink-muted)">
                {c.pctOfCogs.toFixed(1)}%
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-label">Total</td>
            <td className="pt-2 text-right">${total.toFixed(0)}</td>
            <td className="pt-2 text-right">100.0%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
