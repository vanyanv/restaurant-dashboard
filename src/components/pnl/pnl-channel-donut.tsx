"use client"

import { Pie, PieChart, Cell } from "@/components/charts/recharts"
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
  type ChartConfig,
} from "@/components/ui/chart"

const CHANNEL_COLORS: Record<string, string> = {
  "Credit Cards": "hsl(210 80% 55%)",
  Cash: "hsl(152 65% 45%)",
  Uber: "hsl(0 0% 20%)",
  DoorDash: "hsl(0 80% 55%)",
  Grubhub: "hsl(25 90% 55%)",
  ChowNow: "hsl(40 90% 55%)",
  "EZ Cater": "hsl(280 60% 55%)",
  Fooda: "hsl(330 70% 60%)",
  "Otter Online": "hsl(240 60% 55%)",
  "Otter Prepaid": "hsl(260 60% 55%)",
  Beverage: "hsl(195 70% 55%)",
}

export interface PnLChannelDonutProps {
  data: Array<{ channel: string; amount: number }>
  className?: string
}

export function PnLChannelDonut({ data, className }: PnLChannelDonutProps) {
  const total = data.reduce((a, b) => a + b.amount, 0)

  const chartData = data.map((d) => ({
    name: d.channel,
    value: d.amount,
    fill: CHANNEL_COLORS[d.channel] ?? "hsl(220 10% 60%)",
  }))

  const chartConfig: ChartConfig = data.reduce<ChartConfig>((acc, d) => {
    acc[d.channel] = {
      label: d.channel,
      color: CHANNEL_COLORS[d.channel] ?? "hsl(220 10% 60%)",
    }
    return acc
  }, {})

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Channel Mix</CardTitle>
        <CardDescription>Gross sales by channel for the selected range</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
            No sales in this range
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px]">
            <PieChart>
              <ChartTooltip
                content={<ChartTooltipContent nameKey="name" hideLabel />}
              />
              <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={2}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}

        {total > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {data.map((d) => (
              <div key={d.channel} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ background: CHANNEL_COLORS[d.channel] ?? "#888" }}
                />
                <span className="truncate">{d.channel}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {((d.amount / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
