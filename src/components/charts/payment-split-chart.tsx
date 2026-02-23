"use client"

import { Pie, PieChart, Cell } from "recharts"
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

interface PaymentSplitChartProps {
  data: {
    cashSales: number
    cardSales: number
  }
  title?: string
  description?: string
  className?: string
}

export function PaymentSplitChart({
  data,
  title = "Payment Split",
  description = "Cash vs card payments (first-party only)",
  className,
}: PaymentSplitChartProps) {
  const total = data.cashSales + data.cardSales
  if (total === 0) return null

  const chartConfig = {
    cash: {
      label: "Cash",
      color: "hsl(var(--primary))",
    },
    card: {
      label: "Card",
      color: "hsl(var(--primary) / 0.5)",
    },
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value)
  }

  const chartData = [
    { name: "Cash", value: data.cashSales, fill: "var(--color-cash)" },
    { name: "Card", value: data.cardSales, fill: "var(--color-card)" },
  ]

  const cashPct = Math.round((data.cashSales / total) * 100)
  const cardPct = 100 - cashPct

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[200px] md:max-h-[250px]">
          <PieChart>
            <ChartTooltip
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
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={80}
              strokeWidth={2}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "var(--color-cash)" }} />
            <span className="text-muted-foreground">Cash</span>
            <span className="font-medium">{cashPct}% ({formatCurrency(data.cashSales)})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: "var(--color-card)" }} />
            <span className="text-muted-foreground">Card</span>
            <span className="font-medium">{cardPct}% ({formatCurrency(data.cardSales)})</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
