"use client"

import { Bar, BarChart, XAxis, YAxis } from "@/components/charts/recharts"
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

interface RatingDistributionChartProps {
  data: Array<{ rating: number; count: number }>
  className?: string
}

const STAR_COLORS: Record<number, string> = {
  1: "hsl(0, 72%, 51%)",
  2: "hsl(25, 95%, 53%)",
  3: "hsl(45, 93%, 47%)",
  4: "hsl(142, 71%, 45%)",
  5: "hsl(142, 76%, 36%)",
}

export function RatingDistributionChart({
  data,
  className,
}: RatingDistributionChartProps) {
  const chartConfig = {
    count: {
      label: "Reviews",
      color: "hsl(var(--primary))",
    },
  }

  const chartData = [...data]
    .sort((a, b) => b.rating - a.rating)
    .map((d) => ({
      ...d,
      label: `${d.rating} Star`,
      fill: STAR_COLORS[d.rating] ?? "hsl(var(--primary))",
    }))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Rating Distribution</CardTitle>
        <CardDescription>Number of reviews per star rating</CardDescription>
      </CardHeader>
      <CardContent>
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
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent />}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
