import type { ReactNode } from "react"

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
 * ## `.d` HAS NO TONE ON THIS ELEMENT, and that is the sheet's decision
 *
 * `.strip .d` and `.mstrip .d` each carry `.is-down` and `.is-flat` overrides
 * (counter-components.css:174–175 and 475–476). `.mhead .d` does not — it is
 * one rule painting `var(--good)`, exactly like `.headline .d` on the desk
 * (line 155). So this component takes no tone: emitting `is-down` here would
 * put a class on the page that matches no rule, which is the `Meter` defect
 * Phase B found (a component that existed, was exported, was used, and was
 * invisible to the design system). The delta belongs to a figure whose
 * movement the page has already called good; a figure that moved the wrong way
 * is said in the sentence below it, where there are words for it.
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
  note,
}: {
  /** `.k` — "Net sales today", "Net sales · 7 days", "Build-out". */
  label: string
  /** `.v` — pre-formatted. Formatting belongs to `@/lib/counter/format`. */
  value: string
  /** `.d` — "▲ 4.1% vs the same 4 weekdays". Omitted when there is no comparison. */
  delta?: string
  /** The sentence under the figure. Supply the `<p>` — see above. */
  note?: ReactNode
}) {
  return (
    <div className="mhead">
      <span className="k">{label}</span>
      <span data-figure-value className="v">
        {value}
      </span>
      {delta ? <span className="d">{delta}</span> : null}
      {note}
    </div>
  )
}
