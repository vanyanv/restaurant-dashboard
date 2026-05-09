"use client"

import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

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
      color: "var(--ink)",
    },
    netSales: {
      label: "Net Sales",
      color: "var(--accent)",
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
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">{title}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {description}
          </span>
        </div>
      </header>
      <ChartContainer config={chartConfig}>
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ left: 12, right: 12 }}
        >
          <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
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
                formatter={(value) => {
                  const numValue =
                    typeof value === "number" ? value : Number(value)
                  return formatCurrency(numValue)
                }}
              />
            }
          />
          <Bar dataKey="grossSales" fill="var(--color-grossSales)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="netSales" fill="var(--color-netSales)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
