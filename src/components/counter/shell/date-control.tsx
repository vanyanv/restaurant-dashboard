"use client"

import { businessCalendarDate } from "@/lib/counter/business-date"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { startOfMonth } from "date-fns"
import {
  COMPARISONS, MENU_PRESETS, PRESET_GROUPS, bucketFor, canStepForward, compareSentence,
  comparisonWindows, dayCount, describeRange, rangeLabel, stepRange, weekOf,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "@/lib/counter/date-range"
import { useFramePlacement } from "./frame-placement"
import { Calendar } from "./calendar"
import { RangeWeeks } from "./range-weeks"

/**
 * `bar()`, prototype line 1915 — the most-used control in the product, and the
 * one ours was furthest from. Four things it did not have, all of them here now:
 *
 *   1. A TWO-LINE TRIGGER. `.dr__main > span > .lb + .cmp`: the range in
 *      figures on top, `presetName · cmpShort` in mono caps under it. Ours
 *      printed the preset NAME on the trigger and hid the actual dates, so the
 *      one thing every figure on the page is a claim about was not on screen.
 *   2. A `Today` BUTTON (`.dr__today`), outside the stepper group — the way
 *      back from any amount of stepping, in one click.
 *   3. DAY COUNTS ON EVERY PRESET (`<span class="n">7d</span>`), so a reader
 *      picks by span rather than by name.
 *   4. A CALENDAR, for a range no preset names. Two clicks pick it; the second
 *      one calls `onRange`, which `writeCounterParams({ range })` already
 *      writes as `?from=…&to=…` and `rangeLabel(range, "custom")` already names.
 *
 * ```
 * <div class="dr" data-dr>
 *   <button class="dr__step" data-shift="-1">‹
 *   <button class="dr__main" data-open><span><span class="lb">…<span class="cmp">…</span>⌄
 *   <button class="dr__step dr__next" data-shift="1">›
 *   <button class="dr__today" data-preset="today">Today
 *   <div class="drpop">
 *     <div class="drpop__presets"><span class="drpop__k">Presets</span>.drp × 12
 *     <div class="drpop__cal"><div class="drcals">{cal}
 *     <div class="drpop__foot">Compare to · .drcmp · spacer · grain · .btn--primary
 * ```
 *
 * THE POPOVER IS ALWAYS IN THE DOM. `.drpop` is `display:none` until
 * `.dr.is-open` (counter-components.css:925–926), exactly as the prototype
 * writes it — the open state is a class, not a mount. That is also why the
 * fidelity gate sees a `.btn` as the FIRST landmark of the Overview screen:
 * the Apply button lives inside `.pagehead`, whether or not the popover is
 * showing.
 *
 * WHAT IS DELIBERATELY NOT THE PROTYPE'S:
 *
 *   - The comparison list drops "4 same weekdays" past a 7-day range, because
 *     `comparisonRange` returns null for it there and a control that offers a
 *     comparison the page cannot compute renders an empty delta — which reads
 *     as "no change" rather than "that question does not apply here".
 *   - `.lb` omits the year when the range does not straddle one ("Aug 15 – 21",
 *     where the prototype always writes "Aug 15 – 21, 2026"). `rangeLabel` is
 *     this project's single range-naming function and it already decides the
 *     year rule, deliberately and with a comment; a second formatter here to
 *     add a comma and a year is the drift that rule exists to prevent.
 *   - Buttons carry `aria-pressed`, not `role="menuitemradio"`/`aria-checked`.
 *     `.drp[aria-pressed="true"]` and `.drcmp button[aria-pressed="true"]` are
 *     the ONLY selectors that paint the current choice, so the attribute is
 *     load-bearing; `role="menuitemradio"` does not take it.
 *
 * THE NOVEMBER 2026 PASS (owner: "selecting a single date can take multiple
 * clicks"):
 *
 *   - ONE TAP PICKS A DAY. A calendar tap reports that day as the range and
 *     closes. A range by hand is behind the "A range" switch above the
 *     calendar, where two taps make one, as before.
 *   - THE ARROWS WALK CALENDAR UNITS (`stepRange` with `today`): a day, a
 *     Monday week, a month. They report through `onRange`, so a page wires
 *     the arrows by wiring `onRange`; there is no separate step callback.
 *     › is disabled once the window reaches today.
 *   - PRESETS IN FOUR GROUPS (`MENU_PRESETS`, `PRESET_GROUPS`), ten of them.
 *   - THE LAST 8 WEEKS AS BUTTONS (`RangeWeeks`), and week numbers down the
 *     calendar, each one tap for a Monday-to-Sunday week.
 *   - THE SECOND LINE SAYS WHAT THE WINDOW IS (`describeRange`: "This week so
 *     far", "Week of Oct 26"), and the foot says which dates it is compared
 *     with (`compareSentence`).
 *   - The primary button reads "Done": every pick already applied.
 *
 * All the date arithmetic stays in `date-range.ts` — note 19 ("a range that
 * only changes the label is a lie") is why: regenerating the series, not just
 * relabelling it, is the CALLER's job once one of these callbacks fires.
 */

function Chevron({ dir }: { dir: "left" | "right" | "down" }) {
  const d =
    dir === "left" ? "M10 3.5L5.5 8 10 12.5" : dir === "right" ? "M6 3.5L10.5 8 6 12.5" : "M4 6.5L8 10.5 12 6.5"
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export interface DateControlProps {
  presetId: RangeId
  comparisonId: ComparisonId
  range: DateRange
  onPreset: (id: PresetId) => void
  onComparison: (id: ComparisonId) => void
  /**
   * Any window that is not a named preset: a day or a range off the
   * calendar, a week from the week row, and every ‹ › step.
   */
  onRange: (range: DateRange) => void
}

export function DateControl({
  presetId,
  comparisonId,
  range,
  onPreset,
  onComparison,
  onRange,
}: DateControlProps) {
  const [open, setOpen] = useState(false)
  // null = "follow the range": a month the reader navigated to survives a
  // comparison change and a half-finished pick, and is dropped the moment
  // the range itself is replaced.
  const [viewMonth, setViewMonth] = useState<Date | null>(null)
  const [pending, setPending] = useState<Date | null>(null)
  // "day": one tap picks one day. "range": two taps make a range.
  const [mode, setMode] = useState<"day" | "range">("day")
  const cmpLabelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)

  // Escape and an outside click both close without choosing anything.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [open])

  const today = useMemo(() => businessCalendarDate(new Date()), [])

  // `.drpop` is right-anchored; below 640px the stylesheet turns it into a
  // bottom sheet and this returns "position nothing". Note 21.
  const placement = useFramePlacement(open, mainRef, { sheetBelow: 640 })

  const label = rangeLabel(range, "custom")
  const name = describeRange(range, presetId, today)
  const comparison = COMPARISONS.find((c) => c.id === comparisonId) ?? COMPARISONS[0]

  // A comparison the page cannot compute renders an empty delta, which reads
  // as "no change", so it is not offered. "none" always returns null BY
  // DESIGN and is always offered.
  const comparisonOptions = COMPARISONS.filter(
    (c) => c.id === "none" || comparisonWindows(range, c.id) !== null,
  )

  const compare = comparisonWindows(range, comparisonId)
  const anchorMonth = viewMonth ?? startOfMonth(range.end)
  const days = dayCount(range)

  const prev = stepRange(range, -1, today)
  const next = stepRange(range, 1, today)
  const forward = canStepForward(range, today)

  // A custom window that is exactly what a menu preset gives today presses
  // that preset, so stepping back to "This week" lights "This week".
  const activePreset = presetId !== "custom"
    ? presetId
    : MENU_PRESETS.find((p) => {
      const r = p.resolve(today)
      return r.start.getTime() === range.start.getTime() && r.end.getTime() === range.end.getTime()
    })?.id

  function choose(fn: () => void, close: boolean) {
    fn()
    setPending(null)
    setViewMonth(null)
    if (close) setOpen(false)
  }

  function pickDay(day: Date) {
    if (mode === "day") {
      choose(() => onRange({ start: day, end: day }), true)
      return
    }
    if (!pending) {
      setPending(day)
      return
    }
    const [start, end] = day < pending ? [day, pending] : [pending, day]
    choose(() => onRange({ start, end }), true)
  }

  return (
    <div ref={containerRef} className={open ? "dr is-open" : "dr"} data-dr>
      <button
        className="dr__step"
        type="button"
        aria-label={`Earlier (${rangeLabel(prev, "custom")})`}
        onClick={() => choose(() => onRange(prev), false)}
      >
        <Chevron dir="left" />
      </button>

      <button
        className="dr__main"
        type="button"
        ref={mainRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="lb">{label}</span>
          <span className="cmp">
            {name} · {comparison.short}
          </span>
        </span>
        <Chevron dir="down" />
      </button>

      <button
        className="dr__step dr__next"
        type="button"
        aria-label={forward ? `Later (${rangeLabel(next, "custom")})` : "Later (already up to today)"}
        disabled={!forward}
        onClick={() => choose(() => onRange(next), false)}
      >
        <Chevron dir="right" />
      </button>

      <button
        className="dr__today"
        type="button"
        onClick={() => choose(() => onPreset("today"), false)}
      >
        Today
      </button>

      <div
        className={placement.left != null ? "drpop is-clamped" : "drpop"}
        style={{
          ...(placement.width != null ? { width: placement.width } : null),
          ...(placement.left != null ? { left: placement.left } : null),
        }}
      >
        <div className="drpop__presets" role="group" aria-label="Presets">
          {PRESET_GROUPS.map((group) => (
            <div className="drpop__grp" key={group}>
              <span className="drpop__k">{group}</span>
              {MENU_PRESETS.filter((p) => p.group === group).map((p) => (
                <button
                  key={p.id}
                  className="drp"
                  type="button"
                  aria-pressed={p.id === activePreset}
                  onClick={() => choose(() => onPreset(p.id), true)}
                >
                  {p.name}
                  <span className="n">{dayCount(p.resolve(today))}d</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="drpop__cal">
          <RangeWeeks
            range={range}
            today={today}
            onPick={(week) => choose(() => onRange(week), true)}
          />
          <div className="drmode" role="group" aria-label="What a tap on the calendar picks">
            <button
              type="button"
              aria-pressed={mode === "day"}
              onClick={() => {
                setMode("day")
                setPending(null)
              }}
            >
              One day
            </button>
            <button type="button" aria-pressed={mode === "range"} onClick={() => setMode("range")}>
              A range
            </button>
          </div>
          <div className="drcals">
            <Calendar
              month={anchorMonth}
              range={range}
              compare={compare}
              today={today}
              pending={pending}
              onPickDay={pickDay}
              onPickWeek={(monday) => choose(() => onRange(weekOf(monday, today)), true)}
              onMonthChange={setViewMonth}
            />
          </div>
          <p className="drhint">
            {mode === "day"
              ? "Tap a day to show it. Tap a week number for the whole week."
              : pending
                ? "Now tap the last day."
                : "Tap the first day, then the last."}
          </p>
        </div>

        <div className="drpop__foot">
          <span className="lbl" id={cmpLabelId}>
            Compare to
          </span>
          <div className="drcmp" role="group" aria-labelledby={cmpLabelId}>
            {comparisonOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === comparisonId}
                onClick={() => onComparison(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <span className="drcmpline">{compareSentence(range, comparisonId)}</span>
          <span className="spacer" />
          <span className="lbl">
            {bucketFor(range)} buckets · {days} {days === 1 ? "day" : "days"}
          </span>
          <button className="btn btn--primary" type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
