"use client"

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

const PLATFORM_LABELS: Record<string, string> = {
  "css-pos": "Otter POS",
  "bnm-web": "Otter Online",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  caviar: "Caviar",
}

interface PlatformBreakdownChartProps {
  data: Array<{
    platform: string
    paymentMethod?: string | null
    grossSales: number
    netSales: number
    fees: number
    discounts: number
  }>
  title?: string
  description?: string
  className?: string
}

export function PlatformBreakdownChart({
  data,
  title = "Revenue by Platform",
  description = "Gross and net sales breakdown by ordering platform",
  className,
}: PlatformBreakdownChartProps) {
  const chartConfig = {
    grossSales: {
      label: "Gross Sales",
      color: "hsl(var(--primary))",
    },
    netSales: {
      label: "Net Sales",
      color: "hsl(var(--primary) / 0.6)",
    },
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value)
  }

  const chartData = data.map((item) => {
    const base = PLATFORM_LABELS[item.platform] || item.platform
    const name = item.paymentMethod ? `${base} (${item.paymentMethod})` : base
    return { ...item, name }
  })

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => formatCurrency(value)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
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
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="netSales"
              fill="var(--color-netSales)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
