"use client"

import { useMemo } from "react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from "@/components/charts/recharts"
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
} from "@/components/ui/chart"
import { formatCurrency, formatCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ParetoItem } from "@/types/analytics"

interface ParetoChartProps {
  data: ParetoItem[]
  className?: string
}

const ABC_COLORS: Record<"A" | "B" | "C", string> = {
  A: "hsl(var(--chart-1))",
  B: "hsl(var(--chart-3))",
  C: "hsl(var(--chart-5))",
}

const chartConfig: ChartConfig = {
  A: {
    label: "A (Top 80%)",
    color: "hsl(var(--chart-1))",
  },
  B: {
    label: "B (Next 15%)",
    color: "hsl(var(--chart-3))",
  },
  C: {
    label: "C (Bottom 5%)",
    color: "hsl(var(--chart-5))",
  },
}

export function ParetoChart({ data, className }: ParetoChartProps) {
  const chartData = useMemo(() => {
    return data.length > 30 ? data.slice(0, 30) : data
  }, [data])

  if (chartData.length === 0) return null

  const showAllLabels = chartData.length <= 15

  return (
    <Card className={cn("py-3 gap-3", className)}>
      <CardHeader className="pb-0">
        <CardTitle className="text-base">ABC Analysis</CardTitle>
        <CardDescription>
          Items ranked by revenue contribution
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="aspect-[2/1] w-full"
        >
          <ComposedChart
            data={chartData}
            margin={{ left: 12, right: 12, top: 8, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              strokeOpacity={0.5}
            />
            <XAxis
              dataKey="itemName"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={80}
              fontSize={11}
              interval={showAllLabels ? 0 : "preserveStartEnd"}
              tickMargin={4}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatCompact(v)}
              width={60}
              fontSize={12}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              width={45}
              fontSize={12}
            />
            <ReferenceLine
              yAxisId="right"
              y={80}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <ReferenceLine
              yAxisId="right"
              y={95}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <ChartTooltip
              content={<ParetoTooltipContent />}
            />
            <Bar
              dataKey="revenue"
              yAxisId="left"
              radius={[2, 2, 0, 0]}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={ABC_COLORS[entry.abcClass]}
                />
              ))}
            </Bar>
            <Line
              dataKey="cumulativePercent"
              type="monotone"
              yAxisId="right"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          {(["A", "B", "C"] as const).map((cls) => (
            <div key={cls} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 shrink-0 rounded-[2px]"
                style={{ backgroundColor: ABC_COLORS[cls] }}
              />
              <span className="text-muted-foreground">
                {chartConfig[cls].label}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div
              className="h-0.5 w-3 shrink-0"
              style={{ backgroundColor: "hsl(var(--chart-2))" }}
            />
            <span className="text-muted-foreground">Cumulative %</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ParetoTooltipContent({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{
    payload: ParetoItem
    value: number
    dataKey: string
  }>
}) {
  if (!active || !payload?.length) return null

  const item = payload[0].payload

  return (
    <div className="grid min-w-[10rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{item.itemName}</div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Revenue</span>
          <span className="font-mono font-medium tabular-nums">
            {formatCurrency(item.revenue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Cumulative</span>
          <span className="font-mono font-medium tabular-nums">
            {item.cumulativePercent.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Class</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
              item.abcClass === "A" &&
                "bg-[hsl(var(--chart-1)/0.15)] text-[hsl(var(--chart-1))]",
              item.abcClass === "B" &&
                "bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))]",
              item.abcClass === "C" &&
                "bg-[hsl(var(--chart-5)/0.15)] text-[hsl(var(--chart-5))]"
            )}
          >
            {item.abcClass}
          </span>
        </div>
      </div>
    </div>
  )
}
