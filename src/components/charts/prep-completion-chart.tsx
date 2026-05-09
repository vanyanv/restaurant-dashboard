"use client"

import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

interface PrepCompletionChartProps {
  data: Array<{
    task: string
    completed: number
    total: number
    percentage: number
  }>
  title?: string
  description?: string
  className?: string
}

export function PrepCompletionChart({
  data,
  title = "Prep Task Completion",
  description = "Completion rates for each prep task",
  className,
}: PrepCompletionChartProps) {
  const chartConfig = {
    percentage: {
      label: "Completion Rate",
      color: "var(--accent)",
    },
  }

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
          data={data}
          margin={{ left: 12, right: 12 }}
        >
          <XAxis
            dataKey="task"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => `${value}%`}
            domain={[0, 100]}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => {
                  const numValue = typeof value === "number" ? value : Number(value)
                  const item = data.find((d) => d.percentage === numValue)
                  return `${numValue}% (${item?.completed || 0}/${item?.total || 0})`
                }}
              />
            }
          />
          <Bar dataKey="percentage" fill="var(--color-percentage)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </section>
  )
}
