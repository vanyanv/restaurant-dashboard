"use client"

import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtRange(weekStartIso: string): string {
  const start = new Date(`${weekStartIso}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmtL = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  const fmtR = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  return `${fmtL(start)} – ${fmtR(end)}`
}

function isoMondayOf(date: Date): string {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  const dow = d.getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

export function LaborWeekNav({
  weekStart,
  isCurrentWeek,
  daysWithData,
}: {
  weekStart: string
  isCurrentWeek: boolean
  daysWithData: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pickerOpen, setPickerOpen] = useState(false)

  const go = (iso: string) => {
    const monday = isoMondayOf(new Date(`${iso}T00:00:00.000Z`))
    router.push(`${pathname}?week=${monday}`)
  }

  const prev = addDaysISO(weekStart, -7)
  const next = addDaysISO(weekStart, 7)
  const today = new Date()
  const thisWeek = isoMondayOf(today)
  const isFuture = weekStart > thisWeek

  return (
    <nav className="labor-weeknav inv-panel">
      <button
        type="button"
        onClick={() => go(prev)}
        className="labor-weeknav__btn"
        aria-label="Previous week"
      >
        ← Prev
      </button>

      <div className="labor-weeknav__center">
        <span className="labor-weeknav__eyebrow">Week of</span>
        <h2 className="labor-weeknav__title">{fmtRange(weekStart)}</h2>
        <span className="labor-weeknav__sub">
          {isCurrentWeek
            ? `In progress · ${daysWithData}/7 days recorded`
            : daysWithData === 7
              ? "Closed week · 7/7 days recorded"
              : `${daysWithData}/7 days recorded`}
        </span>
      </div>

      <div className="labor-weeknav__right">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="labor-weeknav__btn labor-weeknav__btn--ghost"
        >
          Jump
        </button>
        {!isCurrentWeek && (
          <button
            type="button"
            onClick={() => go(thisWeek)}
            className="labor-weeknav__btn labor-weeknav__btn--ghost"
          >
            This week
          </button>
        )}
        <button
          type="button"
          onClick={() => go(next)}
          disabled={isFuture}
          className="labor-weeknav__btn"
          aria-label="Next week"
        >
          Next →
        </button>
      </div>

      {pickerOpen && (
        <div className="labor-weeknav__picker">
          <input
            type="date"
            defaultValue={weekStart}
            onChange={(e) => {
              if (e.target.value) {
                setPickerOpen(false)
                go(e.target.value)
              }
            }}
            className="labor-weeknav__date"
          />
          <span className="labor-weeknav__hint">
            Snaps to the Monday of that week
          </span>
        </div>
      )}
    </nav>
  )
}
