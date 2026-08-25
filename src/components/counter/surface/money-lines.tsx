import type { ReactNode } from "react"
import { toneStyle, type Tone } from "./tone"

/**
 * A short statement: what it is on the left, what it came to on the right,
 * ruled between, with a heavier last line for the total.
 *
 * Ported from `money()` at line 3088 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="moneyline"><span>Received</span><span>34 · $18,420</span></div>
 * <div class="moneyline"><span>In review</span>
 *      <span style="color:var(--warn);font-weight:600">3 · $2,140</span></div>
 * <div class="moneyline total"><span>Does not reconcile</span><span>1</span></div>
 * ```
 *
 * ## Why this is not `Kv`
 *
 * The prototype has both, they are different marks, and Task 4 ported only
 * one. `kv()` (line 3083) draws a fact list — a `<span>` and a bold `<b>`, no
 * rules, no total. `money()` draws a STATEMENT: every row is ruled off from
 * the next, and `.moneyline.total` is a larger, heavier line with a strong rule
 * above it and no rule below. Substituting `.kv` for it renders the Overview's
 * invoice figures as an unruled list with no total, which is four of that
 * page's missing landmarks and the reason this file exists.
 *
 * ## No wrapper
 *
 * `money()` returns the rows and nothing around them — `.moneyline:last-child`
 * is what drops the final rule, so the rows must be the direct children of the
 * section body. A wrapping `<div>` here would make every row a `:last-child` of
 * a container the sheet does not know about, and the rule under the last row
 * would come back. Hence a fragment.
 */
export interface MoneyLine {
  label: string
  /** Pre-formatted — formatting belongs to `@/lib/counter/format`. */
  value: ReactNode
  /**
   * `total` is a SHAPE (the heavy last line), not a colour, which is why it is
   * not one of the three judgement tones. The prototype conflates them in one
   * argument slot; keeping them apart means a row can be both, and neither can
   * be typed wrong.
   */
  tone?: Tone
  total?: boolean
}

export function MoneyLines({ rows }: { rows: MoneyLine[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={r.total ? "moneyline total" : "moneyline"}>
          <span>{r.label}</span>
          {/* The prototype bolds a toned figure and leaves an untoned one at
              the row's own weight; `.moneyline.total` sets its own weight, so
              a total is never given one here. */}
          <span style={r.tone && !r.total ? { ...toneStyle(r.tone), fontWeight: 600 } : undefined}>
            {r.value}
          </span>
        </div>
      ))}
    </>
  )
}
