"use client"

import { useMemo } from "react"
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  ReferenceLine,
  Cell,
  CartesianGrid,
} from "@/components/charts/recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { formatCurrency, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MatrixItem, MatrixThresholds } from "@/types/analytics"

interface MenuEngineeringMatrixProps {
  items: MatrixItem[]
  thresholds: MatrixThresholds
  className?: string
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary) / 0.6)",
]

export function MenuEngineeringMatrix({
  items,
  thresholds,
  className,
}: MenuEngineeringMatrixProps) {
  const { colorMap, categories, chartConfig } = useMemo(() => {
    const uniqueCategories = Array.from(
      new Set(items.map((item) => item.category))
    )
    const map: Record<string, string> = {}
    const config: Record<string, { label: string; color: string }> = {}

    uniqueCategories.forEach((cat, i) => {
      const color = COLORS[i % COLORS.length]
      map[cat] = color
      const key = cat.replace(/\s+/g, "_").toLowerCase()
      config[key] = { label: cat, color }
    })

    return { colorMap: map, categories: uniqueCategories, chartConfig: config }
  }, [items])

  if (items.length === 0) return null

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Menu Engineering Matrix</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Popularity vs. profitability analysis
          </span>
        </div>
      </header>
      <div>
        <div className="relative">
          {/* Quadrant labels — editorial caption type, no semantic colors */}
          <div className="absolute top-16 left-8 z-10 font-mono text-[9.5px] uppercase tracking-[0.18em] opacity-70 pointer-events-none text-(--ink-muted)">
            Puzzles
          </div>
          <div className="absolute top-16 right-8 z-10 font-mono text-[9.5px] uppercase tracking-[0.18em] opacity-70 pointer-events-none text-(--ink-muted)">
            Stars
          </div>
          <div className="absolute bottom-12 left-8 z-10 font-mono text-[9.5px] uppercase tracking-[0.18em] opacity-70 pointer-events-none text-(--subtract)">
            Dogs
          </div>
          <div className="absolute bottom-12 right-8 z-10 font-mono text-[9.5px] uppercase tracking-[0.18em] opacity-70 pointer-events-none text-(--ink-muted)">
            Workhorses
          </div>

          <ChartContainer config={chartConfig} className="aspect-[3/2] w-full">
            <ScatterChart
              accessibilityLayer
              margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                type="number"
                dataKey="quantitySold"
                name="Quantity Sold"
                label={{
                  value: "Quantity Sold",
                  position: "insideBottom",
                  offset: -10,
                  style: { fontSize: 12 },
                }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                type="number"
                dataKey="avgPrice"
                name="Avg Price"
                label={{
                  value: "Avg Price",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  style: { fontSize: 12 },
                }}
                tickFormatter={(v) => formatCurrency(v)}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <ZAxis range={[40, 40]} />
              <ReferenceLine
                x={thresholds.medianQuantity}
                stroke="var(--ink-muted)"
                strokeDasharray="5 5"
                opacity={0.5}
              />
              <ReferenceLine
                y={thresholds.medianAvgPrice}
                stroke="var(--ink-muted)"
                strokeDasharray="5 5"
                opacity={0.5}
              />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const data = payload[0].payload as MatrixItem
                  return (
                    <div className="rounded-xs border border-(--hairline-bold) bg-(--paper) px-3 py-2 text-xs">
                      <p className="font-medium">{data.itemName}</p>
                      <p className="text-(--ink-muted)">{data.category}</p>
                      <div className="mt-1.5 grid gap-1">
                        <div className="flex justify-between gap-4">
                          <span className="text-(--ink-muted)">Qty Sold</span>
                          <span className="font-medium tabular-nums">
                            {formatNumber(data.quantitySold)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-(--ink-muted)">Avg Price</span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(data.avgPrice)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-(--ink-muted)">Revenue</span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(data.revenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
              <Scatter data={items} dataKey="avgPrice" fillOpacity={0.7}>
                {items.map((item, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={colorMap[item.category]}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ChartContainer>
        </div>

        {/* Category legend */}
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          {categories.map((cat) => (
            <div key={cat} className="flex items-center gap-2">
              <div
                className="h-3 w-3 shrink-0"
                style={{ backgroundColor: colorMap[cat] }}
              />
              <span className="text-(--ink-muted)">{cat}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
