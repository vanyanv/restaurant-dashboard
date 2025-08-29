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

interface ManagerPerformanceChartProps {
  data: Array<{
    name: string
    email: string
    reportsCount: number
    totalRevenue: number
    avgPrepCompletion: number
  }>
  title?: string
  description?: string
  className?: string
}

export function ManagerPerformanceChart({ 
  data, 
  title = "Manager Performance",
  description = "Average prep completion by manager",
  className 
}: ManagerPerformanceChartProps) {
  const chartConfig = {
    avgPrepCompletion: {
      label: "Prep Completion",
      color: "hsl(var(--primary))",
    },
    reportsCount: {
      label: "Reports Count", 
      color: "hsl(var(--muted))",
    },
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
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
              dataKey="name"
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
                  labelClassName="text-sm font-medium"
                  formatter={(value, name, props) => {
                    const manager = props.payload
                    return [
                      <div key="tooltip" className="space-y-1">
                        <div className="font-medium">{manager.name}</div>
                        <div className="text-sm text-muted-foreground">{manager.email}</div>
                        <div className="space-y-0.5">
                          <div>Prep Completion: {manager.avgPrepCompletion}%</div>
                          <div>Reports: {manager.reportsCount}</div>
                          <div>Total Revenue: {formatCurrency(manager.totalRevenue)}</div>
                        </div>
                      </div>
                    ]
                  }}
                />
              }
            />
            <Bar 
              dataKey="avgPrepCompletion" 
              fill="var(--color-avgPrepCompletion)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}