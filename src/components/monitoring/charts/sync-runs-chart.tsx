"use client"

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { EditorialTooltip } from "./tooltip"

type Point = {
  day: Date | string
  success: number
  failure: number
  partial: number
  running: number
}

const AXIS_TICK = {
  fontSize: 9,
  fill: "var(--ink-faint)",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  letterSpacing: "0.08em",
} as const

const SERIES_COLORS: Record<string, string> = {
  success: "var(--ink-muted)",
  partial: "var(--ink-faint)",
  running: "var(--paper-deep)",
  failure: "var(--accent)",
}

export function SyncRunsChart({ data }: { data: Point[] }) {
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
        no sync runs recorded
      </p>
    )
  }

  const chartData = data.map((d) => ({
    day: new Date(d.day).toISOString().slice(5, 10),
    success: d.success,
    partial: d.partial,
    running: d.running,
    failure: d.failure,
  }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={188}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        >
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            axisLine={{ stroke: "var(--hairline-bold)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={32}
          />
          <RechartsTooltip
            cursor={{ fill: "rgba(26, 22, 19, 0.04)" }}
            content={(props) => (
              <EditorialTooltip
                {...props}
                seriesColors={SERIES_COLORS}
                format={(v) => String(Math.round(v))}
              />
            )}
          />
          <Bar
            dataKey="success"
            stackId="a"
            fill={SERIES_COLORS.success}
            isAnimationActive={false}
            maxBarSize={32}
          />
          <Bar
            dataKey="partial"
            stackId="a"
            fill={SERIES_COLORS.partial}
            isAnimationActive={false}
            maxBarSize={32}
          />
          <Bar
            dataKey="running"
            stackId="a"
            fill={SERIES_COLORS.running}
            isAnimationActive={false}
            maxBarSize={32}
          />
          <Bar
            dataKey="failure"
            stackId="a"
            fill={SERIES_COLORS.failure}
            isAnimationActive={false}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
      <Legend />
    </div>
  )
}

function Legend() {
  const items: { label: string; color: string }[] = [
    { label: "success", color: SERIES_COLORS.success },
    { label: "partial", color: SERIES_COLORS.partial },
    { label: "running", color: SERIES_COLORS.running },
    { label: "failure", color: SERIES_COLORS.failure },
  ]
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        marginTop: 6,
        fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
        fontSize: 9,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-muted)",
      }}
    >
      {items.map((it) => (
        <span
          key={it.label}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: it.color,
              border: "1px solid var(--hairline-bold)",
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}
