import type { ReactNode } from "react"
import type { DeltaTone } from "../surface/figure"

/**
 * `.mhead` — the phone's head block, and the first of the three landmark
 * classes that had no emitter anywhere in this tree.
 *
 * Emitted inline inside `P.overview.phone()` at line 4369 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="mhead">
 *   <span class="k">Net sales today</span>
 *   <span class="v">$25,879</span>
 *   <span class="d">▲ 4.1% vs the same 4 weekdays</span>
 *   <p><b>Food cost is 30.9%</b> against a 28.5% plan. Most of the gap is one ingredient.</p>
 * </div>
 * ```
 *
 * It is the phone's whole head block: what the desk spends a `.headline`, two
 * `.fig`s and a `.say` on, the phone states as one figure and one sentence.
 * Vertical space is the scarce thing here and the two charts are directly
 * beneath it.
 *
 * ## `.d` TAKES A TONE, and it did not until the sheet was corrected
 *
 * `.strip .d` and `.mstrip .d` each carry `.is-down` and `.is-flat` overrides
 * in the prototype itself. `.mhead .d` carried neither — one rule painting
 * `var(--good)`, exactly like `.headline .d` on the desk — so the phone's ONE
 * headline figure printed "▼ 37.2% vs the prior period" in the same green a
 * rise gets. That is the prototype's omission, and it is recorded and repaired
 * in `scripts/extract-prototype-css.ts`'s CORRECTIONS table (the generated
 * sheet is asserted byte-identical to that script's output, so it could not be
 * repaired anywhere else). Both surfaces were corrected in one entry.
 *
 * The class is SENTIMENT, not direction — the prototype writes
 * `mkt.d > 0 ? 'is-down'` on one figure and `rep.d < 0 ? 'is-down'` on another
 * on the same page. So the CALLER decides, and a figure whose fall is a win is
 * simply not given it. This component never infers a tone from the arrow in
 * the text it was handed.
 *
 * ## Why `note` is not wrapped in a `<p>` here
 *
 * The prototype's sentence is a `<p>`, and `.mhead p` styles it. In this
 * application that sentence is `sections.verdict` — its own `SectionData`,
 * which fails independently of the net-sales rollup above it — so it arrives
 * wrapped in a `Section bare`, and every one of `Section`'s five non-ready
 * renderings is a `<div>`. A `<div>` inside a `<p>` is invalid HTML and React
 * will not hydrate it. So `note` is rendered as a direct grid child and the
 * CALLER supplies the `<p>` in the ready branch, which is the only branch that
 * has a sentence to put in one.
 *
 * `Section` is the sole state renderer (R3). This takes plain data.
 */
export function MHead({
  label,
  value,
  delta,
  deltaTone,
  note,
}: {
  /** `.k` — "Net sales today", "Net sales · 7 days", "Build-out". */
  label: string
  /** `.v` — pre-formatted. Formatting belongs to `@/lib/counter/format`. */
  value: string
  /** `.d` — "▲ 4.1% vs the same 4 weekdays". Omitted when there is no comparison. */
  delta?: string
  /**
   * `.d`'s class. Unclassed reads as a rise (`var(--good)`); `is-down` is bad
   * news whichever way the figure moved, `is-flat` is a statement of fact.
   * See above — never derived from the arrow.
   */
  deltaTone?: DeltaTone
  /** The sentence under the figure. Supply the `<p>` — see above. */
  note?: ReactNode
}) {
  return (
    <div className="mhead">
      <span className="k">{label}</span>
      <span data-figure-value className="v">
        {value}
      </span>
      {delta ? <span className={deltaTone ? `d ${deltaTone}` : "d"}>{delta}</span> : null}
      {note}
    </div>
  )
}
