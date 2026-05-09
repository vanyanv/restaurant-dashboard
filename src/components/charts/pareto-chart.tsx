"use client"

import { useMemo } from "react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from "@/components/charts/recharts"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import { formatCurrency, formatCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ParetoItem } from "@/types/analytics"

interface ParetoChartProps {
  data: ParetoItem[]
  className?: string
}

const ABC_COLORS: Record<"A" | "B" | "C", string> = {
  A: "var(--ink)",
  B: "var(--accent)",
  C: "var(--ink-muted)",
}

const ABC_BG: Record<"A" | "B" | "C", string> = {
  A: "var(--paper-warm)",
  B: "var(--accent-bg)",
  C: "var(--paper-warm)",
}

const chartConfig: ChartConfig = {
  A: { label: "A (Top 80%)", color: "var(--ink)" },
  B: { label: "B (Next 15%)", color: "var(--accent)" },
  C: { label: "C (Bottom 5%)", color: "var(--ink-muted)" },
}

export function ParetoChart({ data, className }: ParetoChartProps) {
  const chartData = useMemo(() => {
    return data.length > 30 ? data.slice(0, 30) : data
  }, [data])

  if (chartData.length === 0) return null

  const showAllLabels = chartData.length <= 15

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">ABC Analysis</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Items ranked by revenue contribution
          </span>
        </div>
      </header>
      <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
        <ComposedChart
          data={chartData}
          margin={{ left: 12, right: 12, top: 8, bottom: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--chart-grid)"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="itemName"
            tickLine={false}
            axisLine={false}
            angle={-45}
            textAnchor="end"
            height={80}
            fontSize={11}
            interval={showAllLabels ? 0 : "preserveStartEnd"}
            tickMargin={4}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(v) => formatCompact(v)}
            width={60}
            fontSize={12}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            width={45}
            fontSize={12}
          />
          <ReferenceLine
            yAxisId="right"
            y={80}
            stroke="var(--ink-muted)"
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <ReferenceLine
            yAxisId="right"
            y={95}
            stroke="var(--ink-muted)"
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <ChartTooltip content={<ParetoTooltipContent />} />
          <Bar dataKey="revenue" yAxisId="left" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={ABC_COLORS[entry.abcClass]}
              />
            ))}
          </Bar>
          <Line
            dataKey="cumulativePercent"
            type="monotone"
            yAxisId="right"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        {(["A", "B", "C"] as const).map((cls) => (
          <div key={cls} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 shrink-0"
              style={{ backgroundColor: ABC_COLORS[cls] }}
            />
            <span className="text-(--ink-muted)">{chartConfig[cls].label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div
            className="h-0.5 w-3 shrink-0"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <span className="text-(--ink-muted)">Cumulative %</span>
        </div>
      </div>
    </section>
  )
}

function ParetoTooltipContent({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ParetoItem; value: number; dataKey: string }>
}) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload

  return (
    <div className="grid min-w-[10rem] items-start gap-1.5 rounded-xs border border-(--hairline-bold) bg-(--paper) px-2.5 py-1.5 text-xs">
      <div className="font-medium">{item.itemName}</div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-(--ink-muted)">Revenue</span>
          <span className="font-medium tabular-nums">
            {formatCurrency(item.revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-(--ink-muted)">Cumulative</span>
          <span className="font-medium tabular-nums">
            {item.cumulativePercent.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-(--ink-muted)">Class</span>
          <span
            className="inline-flex items-center rounded-xs border border-(--hairline-bold) px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums"
            style={{
              backgroundColor: ABC_BG[item.abcClass],
              color: ABC_COLORS[item.abcClass],
            }}
          >
            {item.abcClass}
          </span>
        </div>
      </div>
    </div>
  )
}
