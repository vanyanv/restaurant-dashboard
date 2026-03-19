"use client"

import { Bar, BarChart, XAxis, YAxis } from "recharts"
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

interface RatingPlatformChartProps {
  data: Array<{ platform: string; avgRating: number; count: number }>
  className?: string
}

const PLATFORM_LABELS: Record<string, string> = {
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
  "css-pos": "POS",
  "bnm-web": "Web",
}

export function RatingPlatformChart({
  data,
  className,
}: RatingPlatformChartProps) {
  const chartConfig = {
    avgRating: {
      label: "Avg Rating",
      color: "hsl(var(--primary))",
    },
  }

  const chartData = data.map((d) => ({
    ...d,
    platformLabel: PLATFORM_LABELS[d.platform] ?? d.platform,
  })).sort((a, b) => b.count - a.count)

  const barHeight = 40
  const chartHeight = Math.max(180, chartData.length * barHeight + 40)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Ratings by Platform</CardTitle>
        <CardDescription>Average rating per delivery platform</CardDescription>
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
            margin={{ left: 12, right: 12 }}
          >
            <XAxis
              type="number"
              domain={[0, 5]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              type="category"
              dataKey="platformLabel"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={80}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    if (name === "avgRating") return `${Number(value).toFixed(2)} stars`
                    return `${value} reviews`
                  }}
                />
              }
            />
            <Bar
              dataKey="avgRating"
              fill="var(--color-avgRating)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
