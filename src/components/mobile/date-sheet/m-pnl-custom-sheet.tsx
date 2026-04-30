"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { localDateStr } from "@/lib/dashboard-utils"
import { formatCustomRangeLong } from "@/lib/mobile/period"
import { autoGrain } from "@/lib/mobile/pnl-period"
import type { Granularity } from "@/lib/pnl"
import { DateSheetShell } from "./date-sheet-shell"
import { EditorialCalendar } from "./editorial-calendar"

type Props = {
  open: boolean
  onClose: () => void
  pathname: string
  searchParams: Record<string, string | undefined>
  initialStart: Date | null
  initialEnd: Date | null
  initialGrain: Granularity | null
}

const GRAIN_OPTIONS: Array<{ value: Granularity; short: string }> = [
  { value: "daily", short: "DAILY" },
  { value: "weekly", short: "WEEKLY" },
  { value: "monthly", short: "MONTHLY" },
]

export function MPnLCustomSheet({
  open,
  onClose,
  pathname,
  searchParams,
  initialStart,
  initialEnd,
  initialGrain,
}: Props) {
  const router = useRouter()
  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)
  // null = "auto"; once user taps a pill, this holds their override.
  const [grainOverride, setGrainOverride] = useState<Granularity | null>(initialGrain)

  // When the range changes, if the user hasn't explicitly chosen a grain,
  // the displayed grain follows autoGrain.
  const effectiveGrain: Granularity =
    grainOverride ??
    (start && end ? autoGrain(start, end) : "weekly")

  // If the range changes such that the override now matches the auto value,
  // collapse back to auto (so URL omits &grain=).
  useEffect(() => {
    if (grainOverride && start && end && grainOverride === autoGrain(start, end)) {
      setGrainOverride(null)
    }
  }, [grainOverride, start, end])

  function apply() {
    if (!start || !end) return
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "period" && k !== "start" && k !== "end" && k !== "grain") {
        merged[k] = v
      }
    }
    merged.period = "custom"
    merged.start = localDateStr(start)
    merged.end = localDateStr(end)
    if (grainOverride) merged.grain = grainOverride
    const qs = new URLSearchParams(merged).toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    onClose()
  }

  const readout = start && end
    ? formatCustomRangeLong(start, end)
    : start
    ? "Pick an end date"
    : "Pick a start date"

  const auto = start && end ? autoGrain(start, end) : null

  return (
    <DateSheetShell
      open={open}
      onClose={onClose}
      dept="DATE RANGE"
      footer={
        <>
          <button type="button" className="m-sheet__btn m-sheet__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m-sheet__btn m-sheet__btn--primary"
            disabled={!start || !end}
            onClick={apply}
          >
            Apply
          </button>
        </>
      }
    >
      <div
        className={`m-sheet__readout${start && end ? "" : " m-sheet__readout--placeholder"}`}
      >
        {readout}
      </div>

      <EditorialCalendar
        initialStart={initialStart}
        initialEnd={initialEnd}
        onChange={(s, e) => {
          setStart(s)
          setEnd(e)
        }}
      />

      <span className="m-grain-toggle__label">GRANULARITY</span>
      <div className="m-grain-toggle" role="tablist" aria-label="Granularity">
        {GRAIN_OPTIONS.map((g) => {
          const active = g.value === effectiveGrain
          return (
            <button
              key={g.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`m-grain-toggle__item${active ? " is-active" : ""}`}
              onClick={() => {
                // Tapping the auto-suggested grain reverts to auto; otherwise sets override.
                if (auto && g.value === auto) {
                  setGrainOverride(null)
                } else {
                  setGrainOverride(g.value)
                }
              }}
            >
              {g.short}
            </button>
          )
        })}
      </div>
      {auto && (
        <span className="m-grain-toggle__hint">
          {grainOverride ? `OVERRIDDEN · AUTO WOULD BE ${auto.toUpperCase()}` : `AUTO · ${auto.toUpperCase()}`}
        </span>
      )}
    </DateSheetShell>
  )
}
