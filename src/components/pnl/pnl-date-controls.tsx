"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { type DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

/** Grouped presets rendered in the popover drawer — same pattern as the
 *  dashboard's DateRangePicker so the two feel like one family. */
const DRAWER_PRESETS: Array<{
  group: string
  label: string
  compute: (today: Date) => [Date, Date]
}> = [
  { group: "Quick views", label: "Today", compute: (t) => [t, t] },
  {
    group: "Quick views",
    label: "Yesterday",
    compute: (t) => {
      const y = subDays(t, 1)
      return [y, y]
    },
  },
  {
    group: "Quick views",
    label: "This week",
    compute: (t) => [startOfWeek(t, { weekStartsOn: 1 }), t],
  },
  {
    group: "Quick views",
    label: "Last week",
    compute: (t) => {
      const thisMon = startOfWeek(t, { weekStartsOn: 1 })
      const lastMon = subDays(thisMon, 7)
      return [lastMon, addDays(lastMon, 6)]
    },
  },
  { group: "Periods", label: "Last 7", compute: (t) => [subDays(t, 6), t] },
  { group: "Periods", label: "Last 14", compute: (t) => [subDays(t, 13), t] },
  { group: "Periods", label: "Last 30", compute: (t) => [subDays(t, 29), t] },
  { group: "Periods", label: "Last 60", compute: (t) => [subDays(t, 59), t] },
  { group: "Periods", label: "Last 90", compute: (t) => [subDays(t, 89), t] },
  {
    group: "To date",
    label: "Month-to-date",
    compute: (t) => [startOfMonth(t), t],
  },
  {
    group: "To date",
    label: "Quarter-to-date",
    compute: (t) => [startOfQuarter(t), t],
  },
  {
    group: "To date",
    label: "Year-to-date",
    compute: (t) => [startOfYear(t), t],
  },
]

function localDateKey(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function PnLDateControls({ state, onChange, isPending }: PnLDateControlsProps) {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined)
  const activePreset = state.preset

  const spanDays = Math.max(1, differenceInCalendarDays(state.endDate, state.startDate) + 1)

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const canStepForward = state.endDate < today

  const applyRange = useCallback(
    (start: Date, end: Date) => {
      // Clamp to not-in-future.
      const clampedEnd = end > today ? today : end
      const clampedStart = start > clampedEnd ? clampedEnd : start
      onChange({
        startDate: startOfDayLocal(clampedStart),
        endDate: startOfDayLocal(clampedEnd),
        granularity: state.granularity,
        preset: undefined,
      })
    },
    [onChange, state.granularity, today]
  )

  const stepBy = useCallback(
    (direction: -1 | 1) => {
      const delta = spanDays * direction
      applyRange(addDays(state.startDate, delta), addDays(state.endDate, delta))
    },
    [applyRange, state.endDate, state.startDate, spanDays]
  )

  // Keyboard shortcuts: [ back, ] forward (skip when typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "[") {
        e.preventDefault()
        stepBy(-1)
      } else if (e.key === "]" && canStepForward) {
        e.preventDefault()
        stepBy(1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stepBy, canStepForward])

  // Dateline readout for the pill.
  const sameDay = spanDays === 1
  const sameYear = state.startDate.getFullYear() === state.endDate.getFullYear()
  const currentYear = today.getFullYear()
  const showYear = !sameYear || state.endDate.getFullYear() !== currentYear
  const dateline = sameDay
    ? format(state.startDate, showYear ? "MMM d, yyyy" : "EEE · MMM d")
    : sameYear
      ? `${format(state.startDate, "MMM d")} – ${format(state.endDate, showYear ? "MMM d, yyyy" : "MMM d")}`
      : `${format(state.startDate, "MMM d, yyyy")} – ${format(state.endDate, "MMM d, yyyy")}`

  // Prior-period readout (same span, immediately prior).
  const prior = useMemo(() => {
    const prevEnd = subDays(state.startDate, 1)
    const prevStart = subDays(prevEnd, spanDays - 1)
    return { start: prevStart, end: prevEnd }
  }, [state.startDate, spanDays])
  const priorReadout = sameDay
    ? format(prior.start, "MMM d, yyyy")
    : prior.start.getFullYear() === prior.end.getFullYear()
      ? `${format(prior.start, "MMM d")} – ${format(prior.end, "MMM d, yyyy")}`
      : `${format(prior.start, "MMM d, yyyy")} – ${format(prior.end, "MMM d, yyyy")}`

  const groupedDrawer = useMemo(() => {
    const order = ["Quick views", "Periods", "To date"] as const
    return order.map((g) => ({
      group: g,
      items: DRAWER_PRESETS.filter((p) => p.group === g),
    }))
  }, [])

  const isDrawerActive = (start: Date, end: Date) =>
    localDateKey(start) === localDateKey(state.startDate) &&
    localDateKey(end) === localDateKey(state.endDate)

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
              onClick={() =>
                onChange({ ...state, granularity: g as Granularity, preset: undefined })
              }
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

      {/* Dateline pill with step arrows — mirrors the home-page date picker */}
      <div className="drp-dateline-group" aria-label="Date range">
        <button
          type="button"
          onClick={() => stepBy(-1)}
          disabled={isPending}
          aria-label="Previous period"
          title="Previous period ( [ )"
          className="drp-step"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>

        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isPending}
              data-active={!activePreset ? "true" : "false"}
              className={cn("drp-dateline", !activePreset && "drp-dateline-custom")}
              aria-label={`Open date picker. Current range: ${dateline}`}
            >
              <span className="drp-dateline-text">{dateline}</span>
              <span className="drp-dateline-span font-mono">
                {spanDays === 1 ? "1 day" : `${spanDays} days`}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="drp-popover w-auto p-0"
            align="end"
            sideOffset={6}
          >
            <div className="drp-popover-grid">
              <aside className="drp-presets">
                {groupedDrawer.map(({ group, items }) => (
                  <div key={group} className="drp-preset-group">
                    <div className="drp-preset-group-label">
                      <span>{group}</span>
                    </div>
                    {items.map(({ label, compute }) => {
                      const [ps, pe] = compute(today)
                      const active = isDrawerActive(ps, pe)
                      return (
                        <button
                          key={label}
                          type="button"
                          className="drp-preset-btn"
                          data-active={active ? "true" : "false"}
                          onClick={() => {
                            applyRange(ps, pe)
                            setCalendarOpen(false)
                            setDraftRange(undefined)
                          }}
                        >
                          <span className="drp-preset-label">{label}</span>
                          <span className="drp-preset-dates font-mono">
                            {format(ps, "M/d")}
                            {localDateKey(ps) === localDateKey(pe)
                              ? ""
                              : `–${format(pe, "M/d")}`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </aside>

              <div className="drp-calendar">
                <Calendar
                  mode="range"
                  selected={draftRange ?? { from: state.startDate, to: state.endDate }}
                  onSelect={(r) => {
                    setDraftRange(r)
                    if (r?.from && r?.to) {
                      applyRange(r.from, r.to)
                      setCalendarOpen(false)
                      setDraftRange(undefined)
                    }
                  }}
                  numberOfMonths={2}
                  defaultMonth={subDays(state.endDate, 30)}
                  disabled={{ after: today }}
                  className="drp-cal-root"
                  formatters={{
                    formatWeekdayName: (d) =>
                      d.toLocaleDateString("en-US", { weekday: "narrow" }),
                  }}
                />
              </div>
            </div>

            <footer className="drp-popover-footer">
              <div className="drp-footer-col">
                <span className="drp-footer-eyebrow">Current</span>
                <span className="drp-footer-value font-mono">{dateline}</span>
              </div>
              <div className="drp-footer-divider" aria-hidden />
              <div className="drp-footer-col">
                <span className="drp-footer-eyebrow">vs. Prior</span>
                <span className="drp-footer-value drp-footer-value-muted font-mono">
                  {priorReadout}
                </span>
              </div>
              <div className="drp-footer-hint font-mono" aria-hidden>
                [ ] to step
              </div>
            </footer>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => stepBy(1)}
          disabled={isPending || !canStepForward}
          aria-label="Next period"
          title="Next period ( ] )"
          className="drp-step"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
