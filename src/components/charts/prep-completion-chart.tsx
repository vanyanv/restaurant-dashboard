"use client"

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts"
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
  className 
}: PrepCompletionChartProps) {
  const chartConfig = {
    percentage: {
      label: "Completion Rate",
      color: "hsl(var(--primary))",
    },
  }

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
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
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
                    const numValue = typeof value === 'number' ? value : Number(value)
                    const item = data.find(d => d.percentage === numValue)
                    return `${numValue}% (${item?.completed || 0}/${item?.total || 0})`
                  }}
                />
              }
            />
            <Bar 
              dataKey="percentage" 
              fill="var(--color-percentage)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}