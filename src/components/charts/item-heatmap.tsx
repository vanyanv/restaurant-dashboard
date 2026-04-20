"use client"

import { memo, useMemo, useState, useCallback, useRef } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCurrency, formatNumber, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ItemDailyCell } from "@/types/analytics"

interface ItemHeatmapProps {
  matrix: ItemDailyCell[]
  itemNames: string[]
  dateRange: { startDate: string; endDate: string }
  onItemClick?: (itemName: string, category: string) => void
  className?: string
}

function getHeatmapColor(value: number, maxValue: number): string {
  if (value === 0 || maxValue === 0) return "hsl(var(--muted))"
  const ratio = Math.min(value / maxValue, 1)
  // Light yellow → orange → deep red
  if (ratio < 0.5) {
    const t = ratio * 2
    const h = 48 - t * 28 // 48 → 20
    const s = 96 - t * 16 // 96 → 80
    const l = 89 - t * 39 // 89 → 50
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  const t = (ratio - 0.5) * 2
  const h = 20 - t * 20 // 20 → 0
  const s = 80 - t * 8  // 80 → 72
  const l = 50 - t * 10 // 50 → 40
  return `hsl(${h}, ${s}%, ${l}%)`
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const current = new Date(start + "T00:00:00")
  const endDate = new Date(end + "T00:00:00")
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0])
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function ItemHeatmapImpl({
  matrix,
  itemNames,
  dateRange,
  onItemClick,
  className,
}: ItemHeatmapProps) {
  const [metric, setMetric] = useState<"quantity" | "revenue">("quantity")
  const [tooltip, setTooltip] = useState<{
    itemName: string
    category: string
    date: string
    quantity: number
    revenue: number
    x: number
    y: number
  } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const dates = useMemo(() => generateDateRange(dateRange.startDate, dateRange.endDate), [dateRange])

  // Build lookup map and category map
  const { lookup, categoryMap } = useMemo(() => {
    const lk = new Map<string, ItemDailyCell>()
    const cm = new Map<string, string>()
    for (const cell of matrix) {
      lk.set(`${cell.itemName}|||${cell.date}`, cell)
      if (!cm.has(cell.itemName)) cm.set(cell.itemName, cell.category)
    }
    return { lookup: lk, categoryMap: cm }
  }, [matrix])

  // Compute max value for color scale
  const maxValue = useMemo(() => {
    let max = 0
    for (const cell of matrix) {
      const val = metric === "quantity" ? cell.quantity : cell.revenue
      if (val > max) max = val
    }
    return max
  }, [matrix, metric])

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, itemName: string, date: string) => {
      const cell = lookup.get(`${itemName}|||${date}`)
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setTooltip({
        itemName,
        category: categoryMap.get(itemName) ?? "",
        date,
        quantity: cell?.quantity ?? 0,
        revenue: cell?.revenue ?? 0,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    },
    [lookup, categoryMap]
  )

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  if (itemNames.length === 0 || dates.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Item Sales Heatmap</CardTitle>
            <CardDescription>
              Daily {metric} intensity for top {itemNames.length} items
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(v) => v && setMetric(v as "quantity" | "revenue")}
          >
            <ToggleGroupItem value="quantity" size="sm" className="text-xs px-2.5 h-7">
              Qty
            </ToggleGroupItem>
            <ToggleGroupItem value="revenue" size="sm" className="text-xs px-2.5 h-7">
              Revenue
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="relative overflow-x-auto">
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `minmax(100px, 140px) repeat(${dates.length}, minmax(20px, 28px))`,
            }}
          >
            {/* Column headers (dates) */}
            <div /> {/* empty corner */}
            {dates.map((date) => (
              <div
                key={date}
                className="text-[9px] text-muted-foreground text-center leading-tight pb-1 select-none"
                style={{ writingMode: "vertical-lr", transform: "rotate(180deg)", height: 48 }}
              >
                {formatDate(date)}
              </div>
            ))}

            {/* Rows */}
            {itemNames.map((name) => (
              <div key={name} className="contents">
                {/* Row header (item name) */}
                <button
                  type="button"
                  onClick={() => onItemClick?.(name, categoryMap.get(name) ?? "")}
                  className="text-xs text-left truncate pr-2 hover:underline hover:text-primary cursor-pointer transition-colors py-0.5"
                  title={name}
                >
                  {name}
                </button>

                {/* Cells */}
                {dates.map((date) => {
                  const cell = lookup.get(`${name}|||${date}`)
                  const value = cell
                    ? metric === "quantity" ? cell.quantity : cell.revenue
                    : 0
                  return (
                    <div
                      key={date}
                      className="aspect-square rounded-[2px] cursor-pointer transition-transform hover:scale-125 hover:z-10"
                      style={{ backgroundColor: getHeatmapColor(value, maxValue) }}
                      onMouseEnter={(e) => handleMouseEnter(e, name, date)}
                      onMouseLeave={handleMouseLeave}
                      onClick={() => onItemClick?.(name, categoryMap.get(name) ?? "")}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute z-50 pointer-events-none bg-popover text-popover-foreground border rounded-md shadow-md px-3 py-2 text-xs"
              style={{
                left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth ?? 300) - 160),
                top: Math.max(tooltip.y - 8, 60),
                transform: "translateY(-100%)",
              }}
            >
              <div className="font-medium">{tooltip.itemName}</div>
              <div className="text-muted-foreground">{formatDate(tooltip.date)}</div>
              <div className="mt-1 space-y-0.5">
                <div>Qty: {formatNumber(tooltip.quantity)}</div>
                <div>Revenue: {formatCurrency(tooltip.revenue)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-0.5">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) => (
              <div
                key={ratio}
                className="w-3 h-3 rounded-[2px]"
                style={{ backgroundColor: getHeatmapColor(ratio * maxValue, maxValue) }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  )
}

export const ItemHeatmap = memo(ItemHeatmapImpl)
