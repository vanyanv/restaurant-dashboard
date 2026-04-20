"use client"

import { useIsMobile } from "@/hooks/use-mobile"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "@/components/charts/recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { formatDate, formatNumber } from "@/lib/format"
import type { MenuDailyTrend } from "@/types/analytics"

interface MenuDailyTrendChartProps {
  data: MenuDailyTrend[]
  className?: string
}

const chartConfig: ChartConfig = {
  fpQuantitySold: {
    label: "First Party",
    color: "hsl(var(--chart-1))",
  },
  tpQuantitySold: {
    label: "Third Party",
    color: "hsl(var(--chart-5))",
  },
  totalQuantitySold: {
    label: "Total",
    color: "hsl(var(--primary))",
  },
}

export function MenuDailyTrendChart({
  data,
  className,
}: MenuDailyTrendChartProps) {
  const isMobile = useIsMobile()

  if (data.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily Items Sold</CardTitle>
        <CardDescription>Items sold per day (FP vs 3P)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] md:h-[340px] w-full">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={formatDate}
              fontSize={12}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatNumber(v)}
              width={isMobile ? 40 : 55}
              fontSize={12}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={formatDate}
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value)
                    return formatNumber(n)
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="totalQuantitySold"
              type="monotone"
              stroke="var(--color-totalQuantitySold)"
              strokeWidth={2.5}
              dot={false}
              connectNulls
            />
            <Line
              dataKey="fpQuantitySold"
              type="monotone"
              stroke="var(--color-fpQuantitySold)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              dataKey="tpQuantitySold"
              type="monotone"
              stroke="var(--color-tpQuantitySold)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
