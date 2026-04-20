"use client"

import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "@/components/charts/recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export interface PnLTrendChartProps {
  periods: Array<{ label: string }>
  totalSales: number[]
  bottomLine: number[]
  className?: string
}

export function PnLTrendChart({
  periods,
  totalSales,
  bottomLine,
  className,
}: PnLTrendChartProps) {
  const chartData = periods.map((p, i) => ({
    label: p.label,
    totalSales: Math.round(totalSales[i] ?? 0),
    bottomLine: Math.round(bottomLine[i] ?? 0),
  }))

  const chartConfig: ChartConfig = {
    totalSales: { label: "Total Sales", color: "hsl(210 80% 55%)" },
    bottomLine: { label: "Bottom Line", color: "hsl(152 65% 45%)" },
  }

  const allZero = chartData.every((d) => d.totalSales === 0 && d.bottomLine === 0)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Sales Trend</CardTitle>
        <CardDescription>Total Sales and Bottom Line over the selected range</CardDescription>
      </CardHeader>
      <CardContent>
        {allZero ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
            No sales in this range
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[260px] w-full">
            <LineChart data={chartData} margin={{ left: 12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                }
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="monotone"
                dataKey="totalSales"
                stroke="var(--color-totalSales)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="bottomLine"
                stroke="var(--color-bottomLine)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
