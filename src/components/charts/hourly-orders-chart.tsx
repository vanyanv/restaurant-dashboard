"use client"

import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import type { HourlyOrderPoint } from "@/types/analytics"

interface HourlyOrdersChartProps {
  data: HourlyOrderPoint[]
  className?: string
}

export function HourlyOrdersChart({ data, className }: HourlyOrdersChartProps) {
  const chartConfig = {
    orderCount: {
      label: "Orders",
      color: "var(--accent)",
    },
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Busiest Hours</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Order volume by hour of day
          </span>
        </div>
      </header>
      <ChartContainer config={chartConfig}>
        <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 4 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={11}
            interval={2}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={32}
            fontSize={11}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => {
                  const point = item.payload as HourlyOrderPoint
                  return (
                    <div className="flex flex-col gap-0.5">
                      <span className="tabular-nums">{Number(value)} orders</span>
                      <span className="text-(--ink-muted) tabular-nums text-xs">
                        {formatCurrency(point.totalSales)} in sales
                      </span>
                    </div>
                  )
                }}
              />
            }
          />
          <Bar
            dataKey="orderCount"
            fill="var(--color-orderCount)"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
