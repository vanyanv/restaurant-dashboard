"use client"

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { EditorialTooltip } from "./tooltip"

type Point = { day: Date | string; hitPct: number }

const AXIS_TICK = {
  fontSize: 9,
  fill: "var(--ink-faint)",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  letterSpacing: "0.08em",
} as const

export function CacheHitChart({ data }: { data: Point[] }) {
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
        no cache stats recorded
      </p>
    )
  }

  const chartData = data.map((d) => ({
    day: new Date(d.day).toISOString().slice(5, 10),
    hitPct: Number(d.hitPct) || 0,
  }))

  const last = chartData[chartData.length - 1]
  const lastIsLow = last && last.hitPct < 30

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
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
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          domain={[0, 100]}
          width={36}
        />
        <RechartsTooltip
          cursor={{
            stroke: "var(--hairline-bold)",
            strokeDasharray: "2 2",
          }}
          content={(props) => (
            <EditorialTooltip
              {...props}
              unit="%"
              format={(v) => v.toFixed(1)}
            />
          )}
        />
        <Line
          type="monotone"
          dataKey="hitPct"
          stroke="var(--ink)"
          strokeWidth={1.5}
          isAnimationActive={false}
          dot={(props) => {
            const { cx, cy, index } = props as {
              cx?: number
              cy?: number
              index?: number
            }
            if (cx == null || cy == null) {
              return <g key={`dot-empty-${index ?? 0}`} />
            }
            const isLast = index === chartData.length - 1
            return (
              <circle
                key={`dot-${index ?? 0}`}
                cx={cx}
                cy={cy}
                r={isLast ? 3 : 2}
                fill={
                  isLast && lastIsLow
                    ? "var(--accent)"
                    : isLast
                      ? "var(--ink)"
                      : "var(--ink-muted)"
                }
                stroke="var(--paper)"
                strokeWidth={1}
              />
            )
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
