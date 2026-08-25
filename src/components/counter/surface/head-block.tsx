import type { ReactNode } from "react"

/**
 * The lead block: the one or two figures an owner checks before anything else,
 * and the verdict that reads them.
 *
 * `headBlock()` at line 3689 of `docs/counter/counter-prototype.html` wraps an
 * inner string; the inner string is written at each page's call site. Overview's
 * (line 4244) is the two-figure form:
 *
 * ```
 * <div class="headline headline--duo">
 *   <div class="fig">          <span class="k"> <span class="v"> <span class="d">
 *   <div class="fig fig--co">  <span class="k"> <span class="v"> <span class="d">  + the floor meter
 *   <div class="say">          the verdict
 * </div>
 * ```
 *
 * Labor (line 5529) and Forecasts (line 4683) use the ONE-figure form, a bare
 * `.headline` with no modifier. Both shapes are in the ported sheet:
 * `.headline` is `minmax(210px,auto) 1fr` and `.headline--duo` is
 * `minmax(178px,auto) minmax(186px,auto) minmax(0,1fr)`
 * (counter-components.css:151, 989). The modifier is therefore a CONSEQUENCE of
 * how many figures there are, not a prop — a caller cannot pass two figures and
 * forget the class, or pass one and get three tracks.
 *
 * There is no rule for three or more. Like `Strip`'s `data-n` gaps this is
 * recorded rather than clamped: a third figure falls through to the two-track
 * `.headline` default and lands wherever grid auto-placement puts it. The
 * prototype never writes one — note 30 is why there are exactly two on
 * Overview: net sales says whether the day happened, sales per labour hour says
 * whether it was worth having, and a third would make neither the point.
 *
 * WHAT IS DELIBERATELY NOT PORTED: `headBlock()` IS A STATE WRAPPER. It
 * inspects `eff()` and substitutes a skeleton body for `loading` and a
 * build-out body for `empty`, returning `inner` only otherwise. Porting that
 * would make this a second state renderer, and `Section` is the sole one
 * (R3) — a page would then have two different components deciding what
 * "empty" looks like, which is note 22's defect. `HeadBlock` takes plain data
 * and renders it. The prototype's empty body is real content, not a
 * placeholder (a pre-open store's build-out percentage and what its store file
 * is still missing), and it belongs to Phase C as an `empty` section body —
 * see the task 6 report.
 *
 * WHY THE `.fig` MARKUP IS HERE AND NOT `Figure size="lead"`. `Figure` derives
 * its meter and `.hfloor` from a `Reference` plus a caption string, which is
 * right for a strip cell but cannot accept `FloorMeter` — whose caption is a
 * judgement it has to make itself so it cannot disagree with its own meter.
 * The three spans this duplicates are the same three spans in both places and
 * the same ported rules style them; the thing that must not be duplicated is
 * the meter, and it is not.
 *
 * `Section` is the sole state renderer (R3).
 */
export interface HeadFigure {
  /** `.k` — what the figure is. Upper-cased by the ported rule. */
  label: string
  /** `.v` — pre-formatted. Formatting belongs to `@/lib/counter/format`. */
  value: string
  /** `.d` — how it moved, and anything bought to move it. */
  detail?: ReactNode
  /** Emitted after `.d`, inside the same `.fig`. `FloorMeter` on Overview's co-lead. */
  meter?: ReactNode
}

export function HeadBlock({
  figures,
  children,
}: {
  figures: HeadFigure[]
  /** The verdict — a `Say`. The prototype's headline always carries one. */
  children: ReactNode
}) {
  const duo = figures.length === 2

  return (
    <div className={duo ? "headline headline--duo" : "headline"}>
      {figures.map((f, i) => (
        <div key={f.label} className={duo && i === 1 ? "fig fig--co" : "fig"}>
          <span className="k">{f.label}</span>
          <span data-figure-value className="v">
            {f.value}
          </span>
          {f.detail ? <span className="d">{f.detail}</span> : null}
          {f.meter}
        </div>
      ))}
      {children}
    </div>
  )
}
