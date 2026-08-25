"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { startOfMonth } from "date-fns"
import {
  COMPARISONS, PRESETS, bucketFor, comparisonRange, dayCount, rangeLabel, stepRange,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "@/lib/counter/date-range"
import { useFramePlacement } from "./frame-placement"
import { Calendar } from "./calendar"

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

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function fmtRange(r: DateRange): string {
  return r.start.getTime() === r.end.getTime() ? fmtDay(r.start) : `${fmtDay(r.start)} – ${fmtDay(r.end)}`
}

export interface DateControlProps {
  presetId: RangeId
  comparisonId: ComparisonId
  range: DateRange
  onPreset: (id: PresetId) => void
  onComparison: (id: ComparisonId) => void
  onStep: (direction: -1 | 1) => void
  /** An arbitrary window picked off the calendar. Two clicks make one. */
  onRange: (range: DateRange) => void
}

export function DateControl({
  presetId,
  comparisonId,
  range,
  onPreset,
  onComparison,
  onStep,
  onRange,
}: DateControlProps) {
  const [open, setOpen] = useState(false)
  // null = "follow the range", which is what the prototype's setPreset/shift do
  // when they reset `state.view` to the month the range ENDS in. A month the
  // reader navigated to survives a comparison change and a half-finished pick,
  // and is dropped the moment the range itself is replaced.
  const [viewMonth, setViewMonth] = useState<Date | null>(null)
  const [pending, setPending] = useState<Date | null>(null)
  const cmpLabelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLButtonElement>(null)

  // Escape and an outside click both close without choosing anything — a stray
  // click or a reflex Escape must never fire one of the callbacks.
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

  // Preset lengths ("7d") are each preset's OWN span, not the selected range's.
  // Most are fixed; the calendar-anchored ones need SOME "today" to resolve
  // against, and the real one is fine here because it only feeds display text.
  const today = useMemo(() => new Date(), [])

  // `.drpop` is 438px wide and right-anchored; below 640px the stylesheet turns
  // it into a bottom sheet and this returns "position nothing". Note 21.
  const placement = useFramePlacement(open, mainRef, { sheetBelow: 640 })

  const label = rangeLabel(range, "custom")
  // The prototype's `presetName()`: the preset's name, or "Custom range" when
  // the window is one no preset names. NOT `rangeLabel(range, presetId)` —
  // that returns the DATES for a custom range, which `.lb` is already showing.
  const presetName = PRESETS.find((p) => p.id === presetId)?.name ?? "Custom range"
  const comparison = COMPARISONS.find((c) => c.id === comparisonId) ?? COMPARISONS[0]

  // Filter by what comparisonRange ACTUALLY returns for this range, rather than
  // a hardcoded length check. "none" is a deliberate exception: it always
  // returns null BY DESIGN — the caller opting out, not a range that failed to
  // resolve.
  const comparisonOptions = COMPARISONS.filter(
    (c) => c.id === "none" || comparisonRange(range, c.id) !== null,
  )

  const compare = comparisonRange(range, comparisonId)
  const anchorMonth = viewMonth ?? startOfMonth(range.end)
  const days = dayCount(range)

  const prevPreview = stepRange(range, -1)
  const nextPreview = stepRange(range, 1)

  function replaceRange(fn: () => void) {
    fn()
    setPending(null)
    setViewMonth(null)
  }

  function pickDay(day: Date) {
    if (!pending) {
      setPending(day)
      return
    }
    const [start, end] = day < pending ? [day, pending] : [pending, day]
    setPending(null)
    onRange({ start, end })
  }

  return (
    <div ref={containerRef} className={open ? "dr is-open" : "dr"} data-dr>
      <button
        className="dr__step"
        type="button"
        aria-label={`Earlier (${fmtRange(prevPreview)})`}
        onClick={() => replaceRange(() => onStep(-1))}
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
            {presetName} · {comparison.short}
          </span>
        </span>
        <Chevron dir="down" />
      </button>

      <button
        className="dr__step dr__next"
        type="button"
        aria-label={`Later (${fmtRange(nextPreview)})`}
        onClick={() => replaceRange(() => onStep(1))}
      >
        <Chevron dir="right" />
      </button>

      <button
        className="dr__today"
        type="button"
        onClick={() => replaceRange(() => onPreset("today"))}
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
          <span className="drpop__k">Presets</span>
          {PRESETS.map((p) => {
            const len = dayCount(p.resolve(today))
            return (
              <button
                key={p.id}
                className="drp"
                type="button"
                aria-pressed={p.id === presetId}
                onClick={() => {
                  replaceRange(() => onPreset(p.id))
                  setOpen(false)
                }}
              >
                {p.name}
                <span className="n">{len}d</span>
              </button>
            )
          })}
        </div>

        <div className="drpop__cal">
          <div className="drcals">
            <Calendar
              month={anchorMonth}
              range={range}
              compare={compare}
              today={today}
              pending={pending}
              onPickDay={pickDay}
              onMonthChange={setViewMonth}
            />
          </div>
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
          <span className="spacer" />
          <span className="lbl">
            {bucketFor(range)} buckets · {days} {days === 1 ? "day" : "days"}
          </span>
          <button className="btn btn--primary" type="button" onClick={() => setOpen(false)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
