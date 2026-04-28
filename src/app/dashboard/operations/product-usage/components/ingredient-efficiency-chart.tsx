"use client"

import { useMemo } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "@/components/charts/recharts"
import { EditorialChartTooltip } from "@/components/charts/editorial-chart-tooltip"
import type { IngredientUsageRow } from "@/types/product-usage"

interface IngredientEfficiencyChartProps {
  data: IngredientUsageRow[]
}

const STATUS_COLOR: Record<IngredientUsageRow["status"], string> = {
  over_ordered: "var(--chart-accent)",
  under_ordered: "var(--chart-subtract)",
  balanced: "var(--chart-ink)",
  no_recipe: "var(--chart-muted)",
}

export function IngredientEfficiencyChart({
  data,
}: IngredientEfficiencyChartProps) {
  const isMobile = useIsMobile()

  const { chartData, stats } = useMemo(() => {
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

    const overCount = data.filter((r) => r.status === "over_ordered").length
    const balancedCount = data.filter((r) => r.status === "balanced").length
    const noRecipeCount = data.filter((r) => r.status === "no_recipe").length

    return {
      chartData: items,
      stats: { overCount, balancedCount, noRecipeCount },
    }
  }, [data])

  if (chartData.length === 0) return null

  const barHeight = 32
  const chartHeight = Math.max(200, chartData.length * barHeight + 40)

  return (
    <section className="inv-panel">
      <div className="inv-panel__head flex-col sm:flex-row sm:items-baseline gap-2">
        <div>
          <span className="inv-panel__dept">§ Ingredient efficiency</span>
          <p
            className="font-display italic text-[18px] mt-0.5"
            style={{ color: "var(--ink)" }}
          >
            Purchased vs theoretical usage{" "}
            <span style={{ color: "var(--ink-faint)" }}>· gap is waste</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stats.overCount > 0 && (
            <span className="inv-stamp" data-tone="alert">
              {stats.overCount} over-ordered
            </span>
          )}
          {stats.balancedCount > 0 && (
            <span className="inv-stamp" data-tone="info">
              {stats.balancedCount} balanced
            </span>
          )}
          {stats.noRecipeCount > 0 && (
            <span className="inv-stamp" data-tone="muted">
              {stats.noRecipeCount} no recipe
            </span>
          )}
        </div>
      </div>

      <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{ left: 12, right: 60 }}
          stackOffset="sign"
        >
          <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} hide />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={isMobile ? 80 : 140}
            tick={{
              fontSize: isMobile ? 10 : 12,
              fill: "var(--ink-muted)",
            }}
          />
          <ReferenceLine x={0} stroke="var(--hairline-bold)" />
          <RechartsTooltip
            cursor={{ fill: "var(--chart-fill-soft)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const datum = payload[0].payload as {
                name: string
                purchased: number
                theoretical: number
                unit: string
                variance: number
                status: IngredientUsageRow["status"]
              }
              return (
                <EditorialChartTooltip
                  active
                  caption={datum.name}
                  rows={[
                    {
                      label: "Purchased",
                      value: `${datum.purchased.toFixed(1)} ${datum.unit}`,
                      tone:
                        datum.status === "over_ordered"
                          ? "accent"
                          : datum.status === "under_ordered"
                            ? "subtract"
                            : "ink",
                    },
                    {
                      label: "Theoretical",
                      value: `${Math.abs(datum.theoretical).toFixed(1)} ${datum.unit}`,
                      tone: "muted",
                    },
                  ]}
                  footnote={`Variance ${datum.variance > 0 ? "+" : ""}${datum.variance.toFixed(1)}%`}
                />
              )
            }}
          />
          <Bar
            dataKey="theoretical"
            fill="var(--chart-muted)"
            radius={[0, 0, 0, 0]}
            stackId="stack"
          />
          <Bar dataKey="purchased" radius={[0, 0, 0, 0]} stackId="stack">
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={STATUS_COLOR[entry.status]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>

      <div
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] uppercase tracking-[0.16em]"
        style={{
          color: "var(--ink-muted)",
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}
      >
        <LegendDot color="var(--chart-muted)" label="Theoretical (left)" />
        <LegendDot color="var(--chart-accent)" label="Over-ordered" />
        <LegendDot color="var(--chart-ink)" label="Balanced" />
        <LegendDot color="var(--chart-subtract)" label="Under-ordered" />
        <span style={{ color: "var(--ink-faint)" }}>· No recipe shown grey</span>
      </div>
    </section>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </span>
  )
}
