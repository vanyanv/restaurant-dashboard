"use client"

import { useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { Bar, BarChart, XAxis, YAxis, Cell, ReferenceLine } from "@/components/charts/recharts"
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
import { Badge } from "@/components/ui/badge"
import type { IngredientUsageRow } from "@/types/product-usage"

interface IngredientEfficiencyChartProps {
  data: IngredientUsageRow[]
}

const STATUS_COLORS = {
  over_ordered: "hsl(0, 72%, 51%)",
  under_ordered: "hsl(38, 92%, 50%)",
  balanced: "hsl(142, 71%, 45%)",
  no_recipe: "hsl(var(--muted-foreground))",
}

const THEORETICAL_COLOR = "hsl(20, 91%, 48%)"

export function IngredientEfficiencyChart({
  data,
}: IngredientEfficiencyChartProps) {
  const isMobile = useIsMobile()

  const { chartData, chartConfig, stats } = useMemo(() => {
    // Take top 15 by purchasedCost, sort by variancePct descending
    const top = [...data]
      .sort((a, b) => b.purchasedCost - a.purchasedCost)
      .slice(0, 15)
      .sort((a, b) => b.variancePct - a.variancePct)

    const items = top.map((row) => ({
      name: row.canonicalName,
      purchased: row.purchasedQuantity,
      theoretical: -Math.abs(row.theoreticalUsage),
      variance: row.variancePct,
      status: row.status,
      unit: row.purchasedUnit,
    }))

    const config = {
      purchased: {
        label: "Purchased",
        color: "hsl(142, 71%, 45%)",
      },
      theoretical: {
        label: "Theoretical",
        color: THEORETICAL_COLOR,
      },
    }

    const overCount = data.filter((r) => r.status === "over_ordered").length
    const balancedCount = data.filter((r) => r.status === "balanced").length
    const noRecipeCount = data.filter((r) => r.status === "no_recipe").length

    return {
      chartData: items,
      chartConfig: config,
      stats: { overCount, balancedCount, noRecipeCount },
    }
  }, [data])

  if (chartData.length === 0) return null

  const barHeight = 32
  const chartHeight = Math.max(200, chartData.length * barHeight + 40)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Ingredient Efficiency</CardTitle>
            <CardDescription>
              Purchased vs theoretical usage — gap represents waste
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {stats.overCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {stats.overCount} over-ordered
              </Badge>
            )}
            {stats.balancedCount > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
              >
                {stats.balancedCount} balanced
              </Badge>
            )}
            {stats.noRecipeCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {stats.noRecipeCount} no recipe
              </Badge>
            )}
          </div>
        </div>
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
            margin={{ left: 12, right: 60 }}
            stackOffset="sign"
          >
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              hide
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={isMobile ? 80 : 140}
              tick={{ fontSize: isMobile ? 10 : 12 }}
            />
            <ReferenceLine x={0} stroke="hsl(var(--border))" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const numValue =
                      typeof value === "number" ? value : Number(value)
                    const absValue = Math.abs(numValue)
                    const unit = item?.payload?.unit ?? ""
                    return `${absValue.toFixed(1)} ${unit}`
                  }}
                />
              }
            />
            <Bar dataKey="theoretical" fill={THEORETICAL_COLOR} radius={[4, 0, 0, 4]} stackId="stack" />
            <Bar dataKey="purchased" radius={[0, 4, 4, 0]} stackId="stack">
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={STATUS_COLORS[entry.status]}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: THEORETICAL_COLOR }}
            />
            <span>Theoretical usage</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STATUS_COLORS.over_ordered }}
            />
            <span>Over-ordered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STATUS_COLORS.balanced }}
            />
            <span>Balanced</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STATUS_COLORS.no_recipe }}
            />
            <span>No recipe</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
