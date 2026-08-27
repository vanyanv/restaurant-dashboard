/**
 * `.wk` / `.wkd` — the labour week, one cell a day, read but not judged.
 *
 * ## Why this is not `WeekPicker`, which renders the same two classes
 *
 * `./week-picker.tsx` was the first instinct and it is the wrong one. Three
 * things separate them, and each of them is a decision this page has already
 * made:
 *
 * 1. **`WeekPicker` draws a verdict.** Its `WeekDay` is `{ forecast, actual }`
 *    and it computes `is-hit` / `is-miss` from `actual >= forecast * 0.97`.
 *    Ruling L-R1 forbids exactly that here: nothing in this schema publishes an
 *    SPLH floor or a labour target, so a labour day has nothing to hit. A cell
 *    here says what the day COST, never whether it passed.
 * 2. **`WeekPicker` is interactive.** It renders each `.wkd` as a `<button>`
 *    (ruling N-R10, with a `button.wkd` repair block in
 *    `src/styles/counter-repairs.css` for the declarations a `<button>` would
 *    otherwise take from the UA sheet). The labour strip selects nothing — the
 *    prototype writes a plain `<div>` — so it stays a `<div>` and needs none of
 *    that repair.
 * 3. **`WeekPicker` is already gated on a shipped page.** Widening its props to
 *    cover a second, verdict-free shape would put a passing fidelity surface at
 *    risk to save one element of markup.
 *
 * Neither `wk` nor `wkd` is in `LANDMARK_CLASSES` (`e2e/fidelity/landmarks.ts`),
 * so two emitters of the same two classes costs nothing at the fidelity gate.
 * What it does cost is that the `.wk` rules in
 * `src/styles/counter-components.css` (the generated sheet — never hand-edited)
 * now have two callers, and both must be looked at together if `.wk` ever moves.
 *
 * ## The bar is a scale, not a grade
 *
 * `bar` arrives 0..100, already computed by `buildWeekStrip` in
 * `src/lib/counter/adapters/labor.ts` as the day's sales per labour hour over
 * the RANGE'S OWN BEST hour. This component does no arithmetic on it and adds
 * no tone class, so every bar paints in `.wkd .bar i`'s own `var(--ink-3)` —
 * the neutral fill. `is-hit` and `is-miss` are never emitted here. The
 * section's `meta` says out loud what the bar is scaled to, so the longest bar
 * cannot be read as a pass.
 *
 * `Section` is the sole state renderer (R3): this takes plain, pre-formatted
 * data and renders it.
 */
export type WeekStripDay = {
  /** Stable id — an ISO day. */
  key: string
  /** The full day, "Wed Aug 26". Not printed; it is the cell's hover title. */
  label: string
  /** `.dn` — what the cell prints: "Wed 26". */
  short: string
  /** `.fv` — the day's hours, already formatted ("56.8 h"), or an em-dash. */
  hours: string
  /** `.av` — the day's sales per labour hour ("$121.10 / h"), or an em-dash. */
  splh: string
  /** `.bar i`'s width, 0..100. A day with no reading gets 0 and no colour. */
  bar: number
  /** The last day of the range — the prototype's `is-today` wash. */
  last: boolean
}

export function WeekStrip({ days }: { days: WeekStripDay[] }) {
  return (
    <div className="wk">
      {days.map((d) => (
        <div className={d.last ? "wkd is-today" : "wkd"} key={d.key} title={d.label}>
          <span className="dn">{d.short}</span>
          <span className="fv">{d.hours}</span>
          <span className="av">{d.splh}</span>
          <span className="bar">
            <i style={{ width: `${d.bar}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}
