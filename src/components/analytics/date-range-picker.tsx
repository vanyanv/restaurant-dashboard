"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
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
import { type DateRange } from "react-day-picker"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

function localDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseLocal(s: string): Date {
  return new Date(s + "T00:00:00")
}

export interface PresetOption {
  label: string
  value: string
}

export interface DrawerPreset {
  group: string
  label: string
  compute: (today: Date) => [Date, Date]
}

export const PRESETS: readonly PresetOption[] = [
  { label: "Today", value: "1" },
  { label: "Yday", value: "-1" },
  { label: "7D", value: "7" },
  { label: "30D", value: "30" },
  { label: "90D", value: "90" },
] as const

export const DRAWER_PRESETS: DrawerPreset[] = [
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
  { group: "Periods", label: "Last 3", compute: (t) => [subDays(t, 3), t] },
  { group: "Periods", label: "Last 7", compute: (t) => [subDays(t, 7), t] },
  { group: "Periods", label: "Last 14", compute: (t) => [subDays(t, 14), t] },
  { group: "Periods", label: "Last 30", compute: (t) => [subDays(t, 30), t] },
  { group: "Periods", label: "Last 90", compute: (t) => [subDays(t, 90), t] },
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

interface DateRangePickerProps {
  days: number
  customRange?: { startDate: string; endDate: string } | null
  onRangeChange: (startDate: string, endDate: string) => void
  isPending?: boolean
  presets?: readonly PresetOption[]
  drawerPresets?: DrawerPreset[]
  activePresetValue?: string
  onPresetClick?: (value: string) => void
}

export function DateRangePicker({
  days,
  customRange,
  onRangeChange,
  isPending,
  presets = PRESETS,
  drawerPresets = DRAWER_PRESETS,
  activePresetValue,
  onPresetClick,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined)

  const activePreset =
    activePresetValue !== undefined
      ? activePresetValue
      : customRange
        ? undefined
        : String(days)

  // Current effective start/end (as Date objects in local time)
  const { startDate, endDate } = useMemo(() => {
    if (customRange) {
      return {
        startDate: parseLocal(customRange.startDate),
        endDate: parseLocal(customRange.endDate),
      }
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (days === 1) return { startDate: today, endDate: today }
    if (days === -1) {
      const y = subDays(today, 1)
      return { startDate: y, endDate: y }
    }
    return { startDate: subDays(today, days), endDate: today }
  }, [customRange, days])

  const spanDays = differenceInCalendarDays(endDate, startDate) + 1

  // Previous period (same span, immediately prior)
  const prior = useMemo(() => {
    const prevEnd = subDays(startDate, 1)
    const prevStart = subDays(prevEnd, spanDays - 1)
    return { start: prevStart, end: prevEnd }
  }, [startDate, spanDays])

  const applyRange = useCallback(
    (start: Date, end: Date) => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      // Clamp to not-in-future
      const clampedEnd = end > today ? today : end
      const clampedStart = start > clampedEnd ? clampedEnd : start
      onRangeChange(localDateStr(clampedStart), localDateStr(clampedEnd))
    },
    [onRangeChange]
  )

  const handlePresetChange = (value: string) => {
    if (!value) return
    if (onPresetClick) {
      onPresetClick(value)
      return
    }
    if (value === "-1") {
      const y = subDays(new Date(), 1)
      const s = localDateStr(y)
      onRangeChange(s, s)
      return
    }
    const d = Number(value)
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = d === 1 ? end : subDays(end, d)
    applyRange(start, end)
  }

  const stepBy = useCallback(
    (direction: -1 | 1) => {
      const delta = spanDays * direction
      applyRange(addDays(startDate, delta), addDays(endDate, delta))
    },
    [applyRange, endDate, spanDays, startDate]
  )

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const canStepForward = endDate < today

  // Keyboard shortcuts ([ and ] to nudge)
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

  const handleCalendarSelect = (range: DateRange | undefined) => {
    setDraftRange(range)
    if (range?.from && range?.to) {
      applyRange(range.from, range.to)
      setOpen(false)
      setDraftRange(undefined)
    }
  }

  // Dateline readout
  const sameDay = spanDays === 1
  const sameYear = startDate.getFullYear() === endDate.getFullYear()
  const currentYear = new Date().getFullYear()
  const showYear = !sameYear || endDate.getFullYear() !== currentYear
  const dateline = sameDay
    ? format(startDate, showYear ? "MMM d, yyyy" : "EEE · MMM d")
    : sameYear
      ? `${format(startDate, "MMM d")} – ${format(endDate, showYear ? "MMM d, yyyy" : "MMM d")}`
      : `${format(startDate, "MMM d, yyyy")} – ${format(endDate, "MMM d, yyyy")}`

  const priorReadout = sameDay
    ? format(prior.start, "MMM d, yyyy")
    : prior.start.getFullYear() === prior.end.getFullYear()
      ? `${format(prior.start, "MMM d")} – ${format(prior.end, "MMM d, yyyy")}`
      : `${format(prior.start, "MMM d, yyyy")} – ${format(prior.end, "MMM d, yyyy")}`

  const groupedDrawer = useMemo(() => {
    const seen: string[] = []
    for (const p of drawerPresets) {
      if (!seen.includes(p.group)) seen.push(p.group)
    }
    return seen.map((g) => ({
      group: g,
      items: drawerPresets.filter((p) => p.group === g),
    }))
  }, [drawerPresets])

  const isDrawerActive = (start: Date, end: Date) =>
    localDateStr(start) === localDateStr(startDate) &&
    localDateStr(end) === localDateStr(endDate)

  return (
    <div className="drp-shell flex items-stretch gap-2">
      {/* Mobile: compact dropdown */}
      <Select
        value={activePreset ?? "custom"}
        onValueChange={(v) => v !== "custom" && handlePresetChange(v)}
        disabled={isPending}
      >
        <SelectTrigger className="lg:hidden h-8 w-[90px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Desktop: preset strip */}
      <ToggleGroup
        type="single"
        value={activePreset}
        onValueChange={handlePresetChange}
        disabled={isPending}
        className="hidden lg:flex overflow-x-auto"
      >
        {presets.map((p) => (
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

      {/* Dateline pill with step arrows */}
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

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isPending}
              data-active={customRange ? "true" : "false"}
              className={cn("drp-dateline", customRange && "drp-dateline-custom")}
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
                            setOpen(false)
                            setDraftRange(undefined)
                          }}
                        >
                          <span className="drp-preset-label">{label}</span>
                          <span className="drp-preset-dates font-mono">
                            {format(ps, "M/d")}
                            {localDateStr(ps) === localDateStr(pe)
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
                  selected={draftRange ?? { from: startDate, to: endDate }}
                  onSelect={handleCalendarSelect}
                  numberOfMonths={2}
                  defaultMonth={subDays(endDate, 30)}
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
