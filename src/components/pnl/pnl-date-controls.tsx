"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
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
import type { Granularity } from "@/lib/pnl"

export interface PnLRangeState {
  startDate: Date
  endDate: Date
  granularity: Granularity
  /** The preset that produced this state, if any. Used to highlight the active pill. */
  preset?: string
}

function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

function thisWeekRange(): { start: Date; end: Date } {
  const today = startOfDay(new Date())
  const day = today.getDay()
  const start = new Date(today)
  start.setDate(today.getDate() - day)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start, end }
}

export const PNL_PRESETS: { key: string; label: string; compute: () => PnLRangeState }[] = [
  {
    key: "today",
    label: "Today",
    compute: () => {
      const d = startOfDay(new Date())
      return { startDate: d, endDate: d, granularity: "daily", preset: "today" }
    },
  },
  {
    key: "yesterday",
    label: "Yesterday",
    compute: () => {
      const d = startOfDay(new Date())
      d.setDate(d.getDate() - 1)
      return { startDate: d, endDate: d, granularity: "daily", preset: "yesterday" }
    },
  },
  {
    key: "thisWeek",
    label: "This Week",
    compute: () => {
      const { start, end } = thisWeekRange()
      return { startDate: start, endDate: end, granularity: "weekly", preset: "thisWeek" }
    },
  },
  {
    key: "lastWeek",
    label: "Last Week",
    compute: () => {
      const { start, end } = thisWeekRange()
      start.setDate(start.getDate() - 7)
      end.setDate(end.getDate() - 7)
      return { startDate: start, endDate: end, granularity: "weekly", preset: "lastWeek" }
    },
  },
  {
    key: "thisMonth",
    label: "This Month",
    compute: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = startOfDay(new Date())
      return { startDate: start, endDate: end, granularity: "monthly", preset: "thisMonth" }
    },
  },
  {
    key: "lastMonth",
    label: "Last Month",
    compute: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { startDate: start, endDate: end, granularity: "monthly", preset: "lastMonth" }
    },
  },
  {
    key: "last8Weeks",
    label: "Last 8 Weeks",
    compute: () => {
      const end = startOfDay(new Date())
      const start = new Date(end)
      start.setDate(start.getDate() - 7 * 8 + 1)
      return { startDate: start, endDate: end, granularity: "weekly", preset: "last8Weeks" }
    },
  },
  {
    key: "last6Months",
    label: "Last 6 Months",
    compute: () => {
      const end = startOfDay(new Date())
      const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
      return { startDate: start, endDate: end, granularity: "monthly", preset: "last6Months" }
    },
  },
]

export function defaultPnLRangeState(): PnLRangeState {
  return PNL_PRESETS.find((p) => p.key === "last8Weeks")!.compute()
}

export interface PnLDateControlsProps {
  state: PnLRangeState
  onChange: (s: PnLRangeState) => void
  isPending?: boolean
}

export function PnLDateControls({ state, onChange, isPending }: PnLDateControlsProps) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined)
  const activePreset = state.preset

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground mr-1">Granularity</span>
      <ToggleGroup
        type="single"
        value={state.granularity}
        onValueChange={(v) => {
          if (!v) return
          onChange({ ...state, granularity: v as Granularity, preset: undefined })
        }}
        disabled={isPending}
      >
        <ToggleGroupItem value="daily" size="sm" className="text-xs h-8">Daily</ToggleGroupItem>
        <ToggleGroupItem value="weekly" size="sm" className="text-xs h-8">Weekly</ToggleGroupItem>
        <ToggleGroupItem value="monthly" size="sm" className="text-xs h-8">Monthly</ToggleGroupItem>
      </ToggleGroup>

      <div className="mx-2 h-6 w-px bg-border hidden md:block" />

      <div className="flex flex-wrap gap-1.5">
        {PNL_PRESETS.map((p) => (
          <Button
            key={p.key}
            type="button"
            size="sm"
            variant={activePreset === p.key ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => onChange(p.compute())}
            disabled={isPending}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            className={cn("h-8 gap-1.5 text-xs", !activePreset && "border-primary")}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {activePreset
              ? "Custom"
              : `${format(state.startDate, "MMM d")} – ${format(state.endDate, "MMM d")}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={draftRange ?? { from: state.startDate, to: state.endDate }}
            onSelect={(r) => {
              setDraftRange(r)
              if (r?.from && r?.to) {
                onChange({
                  startDate: startOfDay(r.from),
                  endDate: startOfDay(r.to),
                  granularity: state.granularity,
                  preset: undefined,
                })
                setCalendarOpen(false)
              }
            }}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
