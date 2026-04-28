"use client"

import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import { EditorialChartTooltip } from "@/components/charts/editorial-chart-tooltip"
import type { HourlyOrderPoint } from "@/types/analytics"

const chartConfig = {
  orderCount: {
    label: "Orders",
    color: "var(--chart-ink)",
  },
  avgOrderCount: {
    label: "4-wk avg",
    color: "var(--chart-muted)",
  },
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value)

interface HourlyOrdersChartProps {
  chartData: HourlyOrderPoint[]
  xInterval: number
  currentLAHour: number | null
  showAvgLine: boolean
}

export function HourlyOrdersChart({
  chartData,
  xInterval,
  currentLAHour,
  showAvgLine,
}: HourlyOrdersChartProps) {
  return (
    <>
      <ChartContainer
        config={chartConfig}
        className="h-[260px] md:h-[320px] lg:h-[360px] w-full"
      >
        <ComposedChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 0, right: 4, top: 4, bottom: 0 }}
        >
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            fontSize={10}
            interval={xInterval}
            stroke="var(--ink-faint)"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={28}
            fontSize={10}
            stroke="var(--ink-faint)"
          />
          <ChartTooltip
            cursor={false}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null
              const point = props.payload[0].payload as HourlyOrderPoint
              const delta = point.orderCount - point.avgOrderCount
              const rows: Array<{
                label: string
                value: string
                tone?: "ink" | "accent" | "subtract" | "muted"
              }> = [
                {
                  label: "Orders",
                  value: String(point.orderCount),
                  tone: "ink",
                },
              ]
              if (showAvgLine && point.avgOrderCount > 0) {
                rows.push({
                  label: "4-wk avg",
                  value: point.avgOrderCount.toFixed(1),
                  tone: "muted",
                })
                rows.push({
                  label: "Δ vs avg",
                  value:
                    (delta > 0 ? "+" : "") +
                    delta.toFixed(1),
                  tone: delta > 0 ? "accent" : delta < 0 ? "subtract" : "muted",
                })
              }
              if (point.totalSales > 0) {
                rows.push({
                  label: "Sales",
                  value: formatCurrency(point.totalSales),
                  tone: "muted",
                })
              }
              return (
                <EditorialChartTooltip
                  active
                  caption={point.label}
                  rows={rows}
                />
              )
            }}
          />
          <Bar dataKey="orderCount" radius={[2, 2, 0, 0]}>
            {chartData.map((entry) => (
              <Cell
                key={`cell-${entry.hour}`}
                fill={
                  currentLAHour !== null && entry.hour === currentLAHour
                    ? "var(--chart-accent)"
                    : "var(--chart-ink)"
                }
              />
            ))}
          </Bar>
          {showAvgLine && (
            <Line
              dataKey="avgOrderCount"
              type="monotone"
              stroke="var(--chart-muted)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
      {showAvgLine && (
        <div
          className="mt-1 flex items-center justify-end gap-3"
          style={{
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 10,
            color: "var(--ink-faint)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span className="flex items-center gap-1.5">
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: "var(--chart-ink)",
                borderRadius: 1,
              }}
            />
            this period
          </span>
          <span className="flex items-center gap-1.5">
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 0,
                borderTop: "1.5px dashed var(--chart-muted)",
              }}
            />
            4-wk avg
          </span>
        </div>
      )}
    </>
  )
}
