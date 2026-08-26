"use client"

import { useId, useState, type CSSProperties } from "react"
import { startOfMonth } from "date-fns"
import {
  COMPARISONS, PRESETS, comparisonRange, dayCount, rangeLabel,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "@/lib/counter/date-range"
import { Calendar } from "./calendar"
import { PhoneSheet } from "./phone-sheet"

/**
 * The phone's date control: `CD.chip()` (prototype line 1942) and
 * `CD.sheet()` (line 1945), which the phone shell composes into `.mtop` and
 * the bottom of `.pframe` respectively.
 *
 * ```
 * <button class="mdate" data-msheet>Aug 15 – 21 ⌄</button>
 * <div class="pshade" data-mclose></div>
 * <div class="msheet">
 *   <span class="msheet__grab"></span>
 *   <h4>Pick a range</h4>
 *   <div class="mpresets"><button aria-pressed>…</button> × 12</div>
 *   <div class="drcals">{cal}</div>
 *   <div …>Compare to <div class="drcmp"><button aria-pressed>…</button></div></div>
 *   <button class="mbtn mbtn--primary" data-mclose>Show 7 days</button>
 * </div>
 * ```
 *
 * WHY `DateControl` DOES NOT SERVE HERE. `.dr` is a four-button bar with a
 * 438px right-anchored popover; the phone gets a chip and a bottom sheet. They
 * are two controls in the prototype, written by two functions, and the sheet
 * drops the stepper and the `Today` button the desk bar carries. All the date
 * ARITHMETIC is shared — `src/lib/counter/date-range.ts` — so the two cannot
 * disagree about what "7 days" means; only the chrome differs. Same split as
 * `.strip`/`.mstrip` and `.stores`/`.pstore`.
 *
 * WHAT IS THE PROTOTYPE'S AND IS KEPT: a preset and a comparison apply
 * immediately and leave the sheet open — only `[data-mclose]` closes it — so a
 * reader sets the window and then the comparison without reopening. The
 * primary button is the close, and it says what it will show.
 *
 * ONE DIVERGENCE OF ITS OWN: the comparison list is filtered by what
 * `comparisonRange` can actually compute, exactly as `DateControl` filters it
 * and for the same reason — a comparison the page cannot compute renders an
 * empty delta, which reads as "no change" rather than "that question does not
 * apply here".
 *
 * `.drcals`'s inline `grid-template-columns:1fr` is deliberately NOT ported:
 * the ported rule already declares exactly that (counter-components.css:939),
 * so the prototype's inline copy is a belt-and-braces no-op. Restating it here
 * would be a layout value this file decided.
 */

/** The prototype's own `ic(CHEV_D)`. */
function ChevronDown() {
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
      <path d="M4 6.5L8 10.5 12 6.5" />
    </svg>
  )
}

/**
 * `.lbl` is styled by `.drpop__foot .lbl` and nowhere else, so outside the
 * desk's popover it has no rule at all. The prototype writes exactly these
 * five declarations inline on the sheet's own label (line 1953); they are
 * transcribed, not chosen here.
 */
const SHEET_LABEL: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: "9px",
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
}

/** The prototype's own inline row around the label and the `.drcmp` group. */
const CMP_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
}

export interface MDateSheetProps {
  presetId: RangeId
  comparisonId: ComparisonId
  range: DateRange
  onPreset: (id: PresetId) => void
  onComparison: (id: ComparisonId) => void
  /** An arbitrary window picked off the calendar. Two taps make one. */
  onRange: (range: DateRange) => void
}

export function MDateSheet({
  presetId,
  comparisonId,
  range,
  onPreset,
  onComparison,
  onRange,
}: MDateSheetProps) {
  const [open, setOpen] = useState(false)
  // null = "follow the range", the same contract `DateControl` keeps: a month
  // the reader navigated to survives a comparison change and a half-finished
  // pick, and is dropped the moment the range itself is replaced.
  const [viewMonth, setViewMonth] = useState<Date | null>(null)
  const [pending, setPending] = useState<Date | null>(null)
  const cmpLabelId = useId()
  const sheetId = useId()

  const days = dayCount(range)
  const today = new Date()
  const comparisonOptions = COMPARISONS.filter(
    (c) => c.id === "none" || comparisonRange(range, c.id) !== null,
  )

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
    <>
      <button
        className="mdate"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => setOpen(true)}
      >
        {rangeLabel(range, "custom")}
        <ChevronDown />
      </button>

      <PhoneSheet open={open} onClose={() => setOpen(false)} title="Pick a range" id={sheetId}>
        <div className="mpresets" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === presetId}
              onClick={() => replaceRange(() => onPreset(p.id))}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="drcals">
          <Calendar
            month={viewMonth ?? startOfMonth(range.end)}
            range={range}
            compare={comparisonRange(range, comparisonId)}
            today={today}
            pending={pending}
            onPickDay={pickDay}
            onMonthChange={setViewMonth}
          />
        </div>

        <div style={CMP_ROW}>
          <span className="lbl" id={cmpLabelId} style={SHEET_LABEL}>
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
        </div>

        <button className="mbtn mbtn--primary" type="button" onClick={() => setOpen(false)}>
          Show {days} {days === 1 ? "day" : "days"}
        </button>
      </PhoneSheet>
    </>
  )
}
