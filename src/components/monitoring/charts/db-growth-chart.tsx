"use client"

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { EditorialTooltip } from "./tooltip"

type Point = { date: Date | string; totalBytes: number }

const AXIS_TICK = {
  fontSize: 9,
  fill: "var(--ink-faint)",
  fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
  letterSpacing: "0.08em",
} as const

export function DbGrowthChart({
  data,
  capBytes,
}: {
  data: Point[]
  capBytes: number
}) {
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
        no snapshots yet — first data point lands when the daily cron runs
      </p>
    )
  }

  const chartData = data.map((d) => ({
    date: new Date(d.date).toISOString().slice(5, 10), // MM-DD
    mb: d.totalBytes / (1024 * 1024),
  }))

  const capMB = capBytes / (1024 * 1024)
  const peakMB = Math.max(...chartData.map((d) => d.mb))
  // y-domain: at least to current peak * 1.15, capped at capMB if cap is reasonable
  const yMax = capMB > 0 && peakMB / capMB < 0.9 ? capMB : peakMB * 1.15

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
      >
        <defs>
          <linearGradient id="db-growth-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          axisLine={{ stroke: "var(--hairline-bold)" }}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${Math.round(v)}MB`}
          domain={[0, yMax]}
          width={48}
        />
        <RechartsTooltip
          cursor={{
            stroke: "var(--hairline-bold)",
            strokeDasharray: "2 2",
          }}
          content={(props) => (
            <EditorialTooltip
              {...props}
              unit=" MB"
              format={(v) => v.toFixed(1)}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="mb"
          stroke="var(--ink)"
          strokeWidth={1.5}
          fill="url(#db-growth-fill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
