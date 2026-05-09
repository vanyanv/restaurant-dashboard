"use client"

import { Bar, BarChart, Cell, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

interface RatingDistributionChartProps {
  data: Array<{ rating: number; count: number }>
  className?: string
}

const STAR_COLORS: Record<number, string> = {
  1: "var(--subtract)",
  2: "var(--ink-faint)",
  3: "var(--ink-muted)",
  4: "var(--accent)",
  5: "var(--ink)",
}

export function RatingDistributionChart({
  data,
  className,
}: RatingDistributionChartProps) {
  const chartConfig = {
    count: {
      label: "Reviews",
      color: "var(--accent)",
    },
  }

  const chartData = [...data]
    .sort((a, b) => b.rating - a.rating)
    .map((d) => ({
      ...d,
      label: `${d.rating} Star`,
      fill: STAR_COLORS[d.rating] ?? "var(--accent)",
    }))

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">Rating Distribution</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Number of reviews per star rating
          </span>
        </div>
      </header>
      <ChartContainer config={chartConfig} className="w-full h-[220px]">
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{ left: 12, right: 12 }}
        >
          <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={60}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="count" radius={[0, 2, 2, 0]}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </section>
  )
}
