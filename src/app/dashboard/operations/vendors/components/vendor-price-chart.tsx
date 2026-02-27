"use client"

import { useState, useMemo } from "react"
import { Line, LineChart, XAxis, YAxis, CartesianGrid } from "recharts"
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
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { VendorPriceTrend } from "@/types/product-usage"

interface VendorPriceChartProps {
  data: VendorPriceTrend[]
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
]

export function VendorPriceChart({ data }: VendorPriceChartProps) {
  const [selectedProduct, setSelectedProduct] = useState<string>(
    data[0]?.productName ?? ""
  )

  const selected = useMemo(
    () => data.find((d) => d.productName === selectedProduct) ?? null,
    [data, selectedProduct]
  )

  // Extract unique vendors and build pivoted chart data
  const { vendors, chartData, chartConfig } = useMemo(() => {
    if (!selected || selected.dataPoints.length === 0) {
      return { vendors: [] as string[], chartData: [] as Record<string, unknown>[], chartConfig: {} as ChartConfig }
    }

    // Get unique vendors in order of first appearance
    const vendorSet = new Set<string>()
    for (const dp of selected.dataPoints) {
      vendorSet.add(dp.vendor)
    }
    const vendorList = Array.from(vendorSet)

    // Group data points by date, with a key per vendor
    const byDate = new Map<string, Record<string, unknown>>()
    for (const dp of selected.dataPoints) {
      if (!byDate.has(dp.date)) {
        byDate.set(dp.date, { date: dp.date })
      }
      const row = byDate.get(dp.date)!
      row[dp.vendor] = dp.avgUnitPrice
    }

    // Sort by date ascending
    const rows = Array.from(byDate.values()).sort((a, b) =>
      (a.date as string).localeCompare(b.date as string)
    )

    // Build chart config for each vendor
    const config: ChartConfig = {}
    vendorList.forEach((vendor, i) => {
      config[vendor] = {
        label: vendor,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }
    })

    return { vendors: vendorList, chartData: rows, chartConfig: config }
  }, [selected])

  // Price change badge
  const priceChangePct = selected?.priceChangePercent ?? null

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor Price Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No vendor price data available.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-3 gap-3">
      <CardHeader className="pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <div>
              <CardTitle className="text-base">Vendor Price Trends</CardTitle>
              <CardDescription className="text-xs">
                Unit price history per ingredient
              </CardDescription>
            </div>
            {priceChangePct !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-mono-numbers",
                  priceChangePct > 0
                    ? "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                    : priceChangePct < 0
                      ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                      : "border-muted text-muted-foreground"
                )}
              >
                {priceChangePct > 0 ? "+" : ""}
                {priceChangePct.toFixed(1)}% vs 30d avg
              </Badge>
            )}
          </div>
          <Select value={selectedProduct} onValueChange={setSelectedProduct}>
            <SelectTrigger className="h-8 w-[200px] text-sm">
              <SelectValue placeholder="Select ingredient" />
            </SelectTrigger>
            <SelectContent>
              {data.map((item) => (
                <SelectItem key={item.productName} value={item.productName}>
                  {item.productName}
                  {item.unit ? ` (${item.unit})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <ChartContainer
            config={chartConfig}
            className="h-[280px] md:h-[340px] w-full"
          >
            <LineChart
              accessibilityLayer
              data={chartData}
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
                tickFormatter={(v) => formatCurrency(v)}
                width={70}
                fontSize={12}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={formatDate}
                    formatter={(value) => {
                      const n =
                        typeof value === "number" ? value : Number(value)
                      return formatCurrency(n)
                    }}
                  />
                }
              />
              {vendors.map((vendor, i) => (
                <Line
                  key={vendor}
                  dataKey={vendor}
                  type="monotone"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={chartData.length < 30}
                  connectNulls
                />
              ))}
            </LineChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No price history for this product.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
