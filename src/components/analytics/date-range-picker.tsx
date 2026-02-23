"use client"

import { useState } from "react"
import { Calendar as CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { type DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

const PRESETS = [
  { label: "Today", value: "1" },
  { label: "3D", value: "3" },
  { label: "7D", value: "7" },
  { label: "14D", value: "14" },
  { label: "30D", value: "30" },
  { label: "90D", value: "90" },
] as const

interface DateRangePickerProps {
  days: number
  customRange?: { startDate: string; endDate: string } | null
  onRangeChange: (startDate: string, endDate: string) => void
  isPending?: boolean
}

export function DateRangePicker({
  days,
  customRange,
  onRangeChange,
  isPending,
}: DateRangePickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  const activePreset = customRange ? undefined : String(days)

  const handlePresetChange = (value: string) => {
    if (!value) return
    const d = Number(value)
    const end = new Date()
    const start = new Date()
    if (d === 1) {
      // "Today" — just today
      start.setHours(0, 0, 0, 0)
    } else {
      start.setDate(end.getDate() - d)
    }
    onRangeChange(
      start.toISOString().split("T")[0],
      end.toISOString().split("T")[0]
    )
  }

  const handleCalendarSelect = (range: DateRange | undefined) => {
    setDateRange(range)
    if (range?.from && range?.to) {
      onRangeChange(
        format(range.from, "yyyy-MM-dd"),
        format(range.to, "yyyy-MM-dd")
      )
      setCalendarOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        value={activePreset}
        onValueChange={handlePresetChange}
        disabled={isPending}
        className="flex overflow-x-auto"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.value}
            value={p.value}
            size="sm"
            className="text-xs px-2.5 h-8 shrink-0"
          >
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            className={cn(
              "h-8 gap-1.5 text-xs",
              customRange && "border-primary"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {customRange ? (
              <span className="hidden sm:inline">
                {format(new Date(customRange.startDate + "T00:00:00"), "MMM d")} -{" "}
                {format(new Date(customRange.endDate + "T00:00:00"), "MMM d")}
              </span>
            ) : (
              <span className="sm:hidden">
                {PRESETS.find((p) => p.value === String(days))?.label ?? `${days}D`}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
