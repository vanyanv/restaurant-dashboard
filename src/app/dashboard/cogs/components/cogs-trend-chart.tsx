"use client"

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { format, parseISO } from "date-fns"
import type { CogsTrendBucket, Granularity } from "@/lib/cogs"

interface CogsTrendChartProps {
  data: CogsTrendBucket[]
  targetCogsPct: number | null
  granularity: Granularity
}

export function CogsTrendChart({
  data,
  targetCogsPct,
  granularity,
}: CogsTrendChartProps) {
  const formatBucket = (k: string) => {
    const d = parseISO(k)
    if (granularity === "monthly") return format(d, "MMM")
    return format(d, "M/d")
  }

  const maxPct = Math.max(...data.map((d) => d.cogsPct), targetCogsPct ?? 30)
  const minPct = Math.min(...data.map((d) => d.cogsPct), targetCogsPct ?? 30)
  const yMax = Math.ceil(Math.max(maxPct + 2, 35) / 5) * 5
  const yMin = Math.max(0, Math.floor(Math.min(minPct - 2, 20) / 5) * 5)

  return (
    <div className="w-full" style={{ aspectRatio: "3 / 1", minHeight: 220 }}>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            stroke="var(--hairline)"
            strokeDasharray="0"
            vertical={false}
          />
          {targetCogsPct != null && (
            <ReferenceArea
              y1={targetCogsPct}
              y2={targetCogsPct + 2}
              ifOverflow="extendDomain"
              className="cogs-trend-band"
              stroke="var(--hairline-bold)"
              strokeWidth={0.75}
            />
          )}
          <XAxis
            dataKey="bucket"
            tickFormatter={formatBucket}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            axisLine={{ stroke: "var(--hairline-bold)" }}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--paper)",
              border: "1px solid var(--hairline-bold)",
              borderRadius: 2,
              fontFamily: "var(--font-jetbrains-mono)",
              fontSize: 11,
            }}
            formatter={(value: number, name: string) => {
              if (name === "cogsPct") return [`${value.toFixed(1)}%`, "COGS %"]
              return [value, name]
            }}
            labelFormatter={(k) => format(parseISO(k as string), "PPP")}
          />
          <Line
            type="monotone"
            dataKey="cogsPct"
            stroke="var(--ink)"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "var(--ink)" }}
            activeDot={{ r: 4 }}
            isAnimationActive
            animationDuration={800}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
