"use client"

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { DailyTrend } from "@/types/analytics"

interface RevenueHeatmapProps {
  data: DailyTrend[]
  title?: string
  description?: string
  className?: string
}

const DAY_LABELS = ["", "M", "", "W", "", "F", ""]

export function RevenueHeatmap({
  data,
  title = "Revenue Heatmap",
  description = "Daily gross revenue intensity",
  className,
}: RevenueHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{
    date: string
    value: number
    x: number
    y: number
  } | null>(null)

  const { weeks, monthLabels, minVal, maxVal } = useMemo(() => {
    if (data.length === 0)
      return { weeks: [], monthLabels: [], minVal: 0, maxVal: 0 }

    // Build a map of date → grossRevenue
    const valueMap = new Map<string, number>()
    for (const d of data) {
      valueMap.set(d.date, d.grossRevenue)
    }

    const values = data.map((d) => d.grossRevenue)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)

    // Find the range of dates
    const sortedDates = data.map((d) => d.date).sort()
    const startDate = new Date(sortedDates[0] + "T00:00:00")
    const endDate = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00")

    // Extend start to previous Sunday
    const startDay = startDate.getDay()
    const gridStart = new Date(startDate)
    gridStart.setDate(gridStart.getDate() - startDay)

    // Extend end to next Saturday
    const endDay = endDate.getDay()
    const gridEnd = new Date(endDate)
    gridEnd.setDate(gridEnd.getDate() + (6 - endDay))

    // Build weeks grid
    const weeks: Array<Array<{ date: string; value: number | null }>> = []
    const monthLabels: Array<{ label: string; weekIndex: number }> = []
    let lastMonth = -1

    const current = new Date(gridStart)
    let weekIndex = 0
    while (current <= gridEnd) {
      const week: Array<{ date: string; value: number | null }> = []
      for (let day = 0; day < 7; day++) {
        const dateStr = current.toISOString().split("T")[0]
        const month = current.getMonth()

        if (day === 0 && month !== lastMonth) {
          monthLabels.push({
            label: current.toLocaleDateString("en-US", { month: "short" }),
            weekIndex,
          })
          lastMonth = month
        }

        week.push({
          date: dateStr,
          value: valueMap.has(dateStr) ? (valueMap.get(dateStr) ?? 0) : null,
        })
        current.setDate(current.getDate() + 1)
      }
      weeks.push(week)
      weekIndex++
    }

    return { weeks, monthLabels, minVal, maxVal }
  }, [data])

  const getIntensity = (value: number): string => {
    if (maxVal === minVal) return "bg-chart-4/60"
    const ratio = (value - minVal) / (maxVal - minVal)
    if (ratio < 0.25) return "bg-chart-4/20"
    if (ratio < 0.5) return "bg-chart-4/40"
    if (ratio < 0.75) return "bg-chart-4/60"
    return "bg-chart-4/90"
  }

  if (data.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="relative min-w-fit">
            {/* Month labels */}
            <div className="flex ml-8 mb-1">
              {monthLabels.map((m, i) => (
                <div
                  key={i}
                  className="text-xs text-muted-foreground"
                  style={{
                    position: "absolute",
                    left: `${m.weekIndex * 16 + 32}px`,
                  }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            <div className="flex gap-px mt-5">
              {/* Day-of-week labels */}
              <div className="flex flex-col gap-px mr-1">
                {DAY_LABELS.map((label, i) => (
                  <div
                    key={i}
                    className="h-3 w-6 text-[10px] text-muted-foreground flex items-center justify-end pr-1"
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Weeks grid */}
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-px">
                  {week.map((cell, di) => (
                    <div
                      key={di}
                      className={`h-3 w-3 rounded-[2px] ${
                        cell.value !== null
                          ? getIntensity(cell.value)
                          : "bg-muted/30"
                      }`}
                      onMouseEnter={(e) => {
                        if (cell.value !== null) {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setHoveredCell({
                            date: cell.date,
                            value: cell.value,
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                          })
                        }
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {hoveredCell && (
          <div
            className="fixed z-50 pointer-events-none bg-popover text-popover-foreground border rounded-md shadow-md px-2.5 py-1.5 text-xs"
            style={{
              left: hoveredCell.x,
              top: hoveredCell.y - 40,
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-medium">{hoveredCell.date}</div>
            <div>{formatCurrency(hoveredCell.value)}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
