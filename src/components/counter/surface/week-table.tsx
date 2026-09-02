import type { KeyboardEvent } from "react"

import { Meter } from "./meter"
import { money, pct } from "@/lib/counter/format"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import { isoDay, monthDay, type DateRange, type WeekWindow } from "@/lib/counter/date-range"

/**
 * The last eight weeks, each one a range you can press.
 *
 * Ported from `weekTable()` at line 5141 of `docs/counter/counter-prototype.html`,
 * over `weekRows()` at 5066:
 *
 * ```
 * <div class="tblscroll"><table class="wkt">
 *   <thead><tr><th>Week of</th><th>Sales</th><th class="num">Gross</th>…</tr></thead>
 * ```
 *
 * (The first `Sales` is headed "Gross vs best" here — see the `<th>` below.)
 * ```
 *   <tbody>
 *     <tr class="is-here" tabindex="0" role="button">
 *       <td>Aug 17 <span class="pt">4 of 7 days</span></td>
 *       <td><span class="bar"><i style="width:62.9%"></i></span></td>
 *       <td class="num">$21,400</td>
 *       <td class="num hot">31.2%</td>
 *       …
 *       <td><span class="mtr"><i class="mtr__f" …></i><i class="mtr__t" …></i></span></td>
 *     </tr>
 *   </tbody>
 * </table></div>
 * <p class="mono">The last row is 4 days, not seven. …</p>
 * ```
 *
 * `.wkt` (`counter-components.css:660-673`) was the ONE landmark class in the
 * whole ported sheet with CSS and no emitter anywhere in the tree. Phase B's
 * Task 8 found it and left it, because it belongs to this page.
 *
 * ## Note 53, and why these are weeks
 *
 * "Weekly is the cadence the trade runs on: a prime-cost variance found in week
 * one can be fixed in week two, and the same variance found in a monthly close
 * has already run for four weeks."
 *
 * Every row is THE SAME STATEMENT over that week — not a summary of it, and not
 * a different reader. That is the promise the press keeps: the figures on the
 * row are the figures the page will show when the range moves to it. A row
 * showing a metric the page does not print would be a link to a different
 * question.
 *
 * ## The four things that are easy to get wrong
 *
 * 1. **The weeks are anchored on TODAY, not on the selected range.** That
 *    belongs to `trailingWeeks` (`date-range.ts`), which takes no range and
 *    cannot be given one — if the list were derived from the range, pressing a
 *    row would rebuild the list around the row that was pressed and slide the
 *    other seven out from under the finger. The eight rows stay put; the marker
 *    moves to whichever is being read.
 *
 * 2. **A part-week is drawn short and labelled short.** Its bar is its own
 *    dollars against the biggest week on the table, its caption says "4 of 7
 *    days", and a note under the table says its dollars are smaller for that
 *    reason alone while its rates are not. Nothing here scales a short week up
 *    to a notional seven days: a reader comparing an unlabelled part-week
 *    against seven full ones is being misled by the table itself.
 *
 * 3. **Pressing a row sets a CUSTOM range.** `onSelect` hands back that row's
 *    own window, which `writeCounterParams({ range })` writes as `?from=…&to=…`
 *    and `rangeLabel(range, "custom")` names. That machinery landed in a
 *    withdrawn plan and has sat unused since; this is its caller.
 *
 * 4. **The marked row is `tr.is-here` INSIDE `.wkt tbody`, and it needs both
 *    halves.** `.wkt tbody tr.is-here` washes the row (668) and
 *    `.wkt tbody tr.is-here td:first-child` adds the accent rail and the bold
 *    first cell (669). `is-here` on a table that is not `.wkt`, or on a row that
 *    is not in a `tbody`, paints nothing at all.
 *
 *    NOTE FOR ANYONE COMPARING THIS WITH `Table`: the pressable-row hook on
 *    `.tbl` is a DIFFERENT pair — `tr[data-ln].is-on` (311-313) — and `.tbl`
 *    also carries an `is-sel` (214-216) that paints a wash and a bold cell and
 *    NO rail. Neither belongs to `.wkt`, which has no `[data-ln]` requirement
 *    and no `is-sel` rule of its own. Three near-identical selected-row hooks
 *    live in this sheet and only one of them paints this table; none of the
 *    three is a fidelity landmark, so picking the wrong one is invisible to
 *    every gate in the project. `tests/components/counter/week-table.test.tsx`
 *    proves the rail against the shipped sheet rather than against a string.
 *
 * ## Why this is not `Table`
 *
 * `Table` hardcodes `className="tbl"`, and `.tbl` and `.wkt` are two different
 * designs: different padding, a different head, a different selected-row hook,
 * and three marks (`.bar`, `.pt`, `.mtr` in a cell) that `.tbl` has no rules
 * for. Widening `Table` to emit either class would put the wrong selected-row
 * hook one boolean away from every caller.
 *
 * `Section` is the sole state renderer (R3): this takes plain data and has no
 * loading, empty or failed branch of its own.
 */

/**
 * The fixed domain of the prime-cost meter column, from the prototype's own
 * `meter(w.p.pct.prime, 48, 66, PRIME_PLAN, over)` (line 5155).
 *
 * Fixed, and shared down the whole column, because that is the only thing that
 * makes a stack of meters readable: 55% is the same distance from the left in
 * every row. Scaling each row to its own value would make eight different
 * weeks draw eight identical marks.
 */
const PRIME_METER_LO = 48
const PRIME_METER_HI = 66

/**
 * One week, and the statement over it.
 *
 * **Every `…Pct` here is PERCENTAGE POINTS, 0–100** — the scale `primeCost()`
 * returns, not a fraction. A fraction passed in prints "0.3%" where the week
 * read 27.4%, and would sit under every target forever.
 *
 * `null` is "no reading", never zero: a week with no sales has no food
 * percentage, and printing `0.0%` for it reads as a perfect one.
 */
export interface WeekRow {
  /** The window itself, from `trailingWeeks` — clipped end and all. */
  window: WeekWindow
  grossSales: number
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  /** What was kept, in dollars. */
  bottomLine: number
  marginPct: number | null
}

export interface WeekTableProps {
  /** Oldest first, as `trailingWeeks` returns them. */
  weeks: WeekRow[]
  /** The range the page is currently reading — what the marker is looking for. */
  selected: DateRange
  /**
   * What the date control at the top of the page CALLS that range. Passed in
   * rather than derived, so the note under the table names the range in the
   * same words the control does — "Last 7 days", not a restatement of its ends.
   */
  selectedLabel: string
  /**
   * `Store.targetCogsPct` — the one published reference in the schema
   * (`targets.ts`). `null` when the store has not set one, and then no food
   * cell is called out: a cell painted "over" with nothing to be over is the
   * page inventing a benchmark.
   */
  foodTargetPct: number | null
  /** Hands back the pressed row's OWN window. See point 3 above. */
  onSelect: (range: DateRange) => void
}

/** A row is marked by the DAY its window covers, not by clock equality. A range
 *  resolved from `new Date()` carries a time of day, and `14:32 !== 00:00`
 *  would silently unmark the row the reader is sitting on. */
const sameWindow = (a: DateRange, b: DateRange) =>
  isoDay(a.start) === isoDay(b.start) && isoDay(a.end) === isoDay(b.end)

const rowLabel = (w: WeekWindow) =>
  `Read ${monthDay(w.start)} – ${monthDay(w.end)}${w.partial ? `, ${w.days} of 7 days,` : ""} in full`

export function WeekTable({
  weeks, selected, selectedLabel, foodTargetPct, onSelect,
}: WeekTableProps) {
  // Not an empty `.wkt` with a head and no body: eight weeks of nothing is a
  // state, and states belong to `Section`.
  if (weeks.length === 0) return null

  // The bar's domain is the biggest week ON THIS TABLE, so the column reads as
  // one comparison. `<= 0` guards a table of pre-open weeks, where the
  // prototype's bare division would write `width:NaN%` into every row.
  const peak = Math.max(...weeks.map((w) => w.grossSales))
  const barWidth = (v: number) =>
    peak <= 0 ? "0.0%" : `${Math.max(0, Math.min(100, (v / peak) * 100)).toFixed(1)}%`

  const marked = weeks.find((w) => sameWindow(w.window, selected)) ?? null
  const short = weeks.find((w) => w.window.partial) ?? null

  return (
    <>
      <div className="tblscroll">
        <table className="wkt">
          <thead>
            <tr>
              <th scope="col">Week of</th>
              {/*
                * "Gross vs best", not the prototype's "Sales".
                *
                * This bar and the column to its right are ONE measure: the bar
                * is `grossSales` against the biggest week on the table, and
                * the number is `grossSales`. Heading them "Sales" and "Gross"
                * put two revenue words side by side on a profit-and-loss
                * table, where gross-versus-net is a distinction that carries
                * money — so the pair read as two different figures.
                *
                * The row already has the right pattern two columns along:
                * "Prime vs 60%" heads a meter and "Prime" heads its number.
                * This says the same thing about the same relationship, and
                * names the domain the comment below sets.
                */}
              <th scope="col">Gross vs best</th>
              <th scope="col" className="num">Gross</th>
              <th scope="col" className="num">Food</th>
              <th scope="col" className="num">Labor</th>
              <th scope="col">{`Prime vs ${PRIME_CEILING_PCT}%`}</th>
              <th scope="col" className="num">Prime</th>
              <th scope="col" className="num">Kept</th>
              <th scope="col" className="num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const here = w === marked
              const overPrime = w.primePct !== null && w.primePct > PRIME_CEILING_PCT
              const overFood =
                w.cogsPct !== null && foodTargetPct !== null && w.cogsPct > foodTargetPct
              const press = () => onSelect({ start: w.window.start, end: w.window.end })
              // A row is not a button, so it is told to behave like one — the
              // prototype's own words at line 9146.
              const keyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key !== "Enter" && e.key !== " ") return
                e.preventDefault()
                press()
              }

              return (
                <tr
                  key={isoDay(w.window.start)}
                  className={here ? "is-here" : undefined}
                  // The prototype's rows are marked only by paint. `aria-current`
                  // is what says "this is the one you are reading" to a reader
                  // who cannot see the wash or the rail.
                  aria-current={here ? "true" : undefined}
                  // Without this a `role="button"` announces the whole row as
                  // one run of figures. Its own cells are the reading; the name
                  // is what pressing it does.
                  aria-label={rowLabel(w.window)}
                  role="button"
                  tabIndex={0}
                  onClick={press}
                  onKeyDown={keyDown}
                >
                  <td>
                    {monthDay(w.window.start)}
                    {w.window.partial ? (
                      <>
                        {" "}
                        <span className="pt">{w.window.days} of 7 days</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className="bar">
                      <i style={{ width: barWidth(w.grossSales) }} />
                    </span>
                  </td>
                  <td className="num">{money(w.grossSales)}</td>
                  <td className={overFood ? "num hot" : "num"}>
                    {pct(w.cogsPct, { scaled: true })}
                  </td>
                  <td className="num">{pct(w.laborPct, { scaled: true })}</td>
                  <td>
                    {w.primePct === null ? null : (
                      <Meter
                        value={w.primePct}
                        lo={PRIME_METER_LO}
                        hi={PRIME_METER_HI}
                        target={PRIME_CEILING_PCT}
                        over={overPrime}
                        label={
                          `Prime cost ${w.primePct.toFixed(1)} percent against a ` +
                          `${PRIME_CEILING_PCT} percent ceiling`
                        }
                      />
                    )}
                  </td>
                  <td className={overPrime ? "num hot" : "num"}>
                    {pct(w.primePct, { scaled: true })}
                  </td>
                  <td className="num">{money(w.bottomLine)}</td>
                  <td className="num">{pct(w.marginPct, { scaled: true })}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {short === null ? null : (
        <p className="mono" style={{ margin: "10px 0 0" }}>
          The last row is {short.window.days} days, not seven. Its dollars are smaller for that
          reason alone &mdash; the rates beside them are not.
        </p>
      )}
      {marked === null ? (
        <p className="mono" style={{ margin: "6px 0 0" }}>
          The range above is {selectedLabel}, which is not one of these weeks, so no row is marked.
        </p>
      ) : null}
    </>
  )
}
