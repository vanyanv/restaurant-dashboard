"use client"

import { Line, LineChart, XAxis, YAxis, ReferenceLine } from "@/components/charts/recharts"
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

interface RatingTrendChartProps {
  data: Array<{ date: string; avgRating: number; count: number }>
  className?: string
}

export function RatingTrendChart({
  data,
  className,
}: RatingTrendChartProps) {
  const chartConfig = {
    avgRating: {
      label: "Avg Rating",
      color: "hsl(var(--primary))",
    },
    count: {
      label: "Reviews",
      color: "hsl(var(--muted-foreground))",
    },
  }

  const chartData = data.map((d) => ({
    ...d,
    dateLabel: new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Ratings Over Time</CardTitle>
        <CardDescription>Daily average rating trend</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="w-full h-[220px]">
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ left: 12, right: 12, top: 8 }}
          >
            <XAxis
              dataKey="dateLabel"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[1, 5]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={30}
            />
            <ReferenceLine y={3} stroke="hsl(var(--muted-foreground) / 0.3)" strokeDasharray="3 3" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    if (name === "avgRating") return `${Number(value).toFixed(2)} stars`
                    return `${value} reviews`
                  }}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="avgRating"
              stroke="var(--color-avgRating)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
