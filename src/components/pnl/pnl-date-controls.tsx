"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
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
    <div className="pnl-controls">
      <div className="pnl-controls__group">
        <span className="pnl-controls__label">Granularity</span>
        <div className="pnl-controls__seg" role="radiogroup" aria-label="Granularity">
          {(["daily", "weekly", "monthly"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={state.granularity === g}
              className={cn(
                "pnl-controls__segItem",
                state.granularity === g && "pnl-controls__segItem--active"
              )}
              onClick={() => onChange({ ...state, granularity: g, preset: undefined })}
              disabled={isPending}
            >
              {g === "daily" ? "Day" : g === "weekly" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      <div className="pnl-controls__divider" aria-hidden />

      <div className="pnl-controls__group">
        <span className="pnl-controls__label">Range</span>
        <div className="pnl-controls__pills">
          {PNL_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={cn(
                "pnl-controls__pill",
                activePreset === p.key && "pnl-controls__pill--active"
              )}
              onClick={() => onChange(p.compute())}
              disabled={isPending}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={cn(
              "pnl-controls__pill pnl-controls__pill--custom",
              !activePreset && "pnl-controls__pill--active"
            )}
          >
            <CalendarIcon className="h-3 w-3" />
            {activePreset
              ? "Custom…"
              : `${format(state.startDate, "MMM d")} – ${format(state.endDate, "MMM d")}`}
          </button>
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
