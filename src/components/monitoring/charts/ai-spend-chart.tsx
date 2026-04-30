"use client"

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { EditorialTooltip } from "./tooltip"

type Point = { day: Date | string; cost: number }

const AXIS_TICK = {
  fontSize: 9,
  fill: "var(--ink-faint)",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  letterSpacing: "0.08em",
} as const

export function AiSpendChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          padding: "32px 0",
          textAlign: "center",
        }}
      >
        no AI activity in this window
      </p>
    )
  }

  const chartData = data.map((d) => ({
    day: new Date(d.day).toISOString().slice(5, 10),
    cost: Number(d.cost) || 0,
  }))

  // Mark "elevated" days (>50% above 30-day mean) so they paint accent.
  const mean =
    chartData.reduce((a, b) => a + b.cost, 0) / Math.max(1, chartData.length)
  const elevatedThreshold = mean * 1.5

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
      >
        <XAxis
          dataKey="day"
          tick={AXIS_TICK}
          axisLine={{ stroke: "var(--hairline-bold)" }}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(v >= 10 ? 0 : 1)}`}
          width={48}
        />
        <RechartsTooltip
          cursor={{ fill: "rgba(26, 22, 19, 0.04)" }}
          content={(props) => (
            <EditorialTooltip
              {...props}
              prefix="$"
              format={(v) => v.toFixed(2)}
            />
          )}
        />
        <Bar
          dataKey="cost"
          isAnimationActive={false}
          maxBarSize={28}
        >
          {chartData.map((d, i) => (
            <Cell
              key={`bar-${i}`}
              fill={
                d.cost > elevatedThreshold && d.cost > 0
                  ? "var(--accent)"
                  : "var(--ink)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
