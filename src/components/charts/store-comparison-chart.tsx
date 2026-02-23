"use client"

import { useIsMobile } from "@/hooks/use-mobile"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
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
} from "@/components/ui/chart"

interface StoreComparisonChartProps {
  data: Array<{
    storeName: string
    grossSales: number
    netSales: number
  }>
  title?: string
  description?: string
  className?: string
}

export function StoreComparisonChart({
  data,
  title = "Store Comparison",
  description = "Gross and net sales by location",
  className,
}: StoreComparisonChartProps) {
  const isMobile = useIsMobile()

  const chartConfig = {
    grossSales: {
      label: "Gross Sales",
      color: "hsl(var(--primary))",
    },
    netSales: {
      label: "Net Sales",
      color: "hsl(var(--primary) / 0.5)",
    },
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value)
  }

  const chartData = [...data].sort((a, b) => b.grossSales - a.grossSales)

  const barHeight = 40
  const chartHeight = Math.max(180, chartData.length * barHeight + 40)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: chartHeight }}
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ left: 12, right: 12 }}
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => formatCurrency(value)}
            />
            <YAxis
              type="category"
              dataKey="storeName"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={isMobile ? 80 : 120}
              tick={{ fontSize: isMobile ? 11 : 14 }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => {
                    const numValue =
                      typeof value === "number" ? value : Number(value)
                    return formatCurrency(numValue)
                  }}
                />
              }
            />
            <Bar
              dataKey="grossSales"
              fill="var(--color-grossSales)"
              radius={[0, 4, 4, 0]}
            />
            <Bar
              dataKey="netSales"
              fill="var(--color-netSales)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
