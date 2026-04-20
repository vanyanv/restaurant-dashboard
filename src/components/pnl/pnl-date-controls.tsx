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
import {
  PNL_PRESETS,
  defaultPnLRangeState,
  startOfDayLocal,
  type PnLRangeState,
} from "./pnl-date-presets"

export { PNL_PRESETS, defaultPnLRangeState, type PnLRangeState }

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
                  startDate: startOfDayLocal(r.from),
                  endDate: startOfDayLocal(r.to),
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
