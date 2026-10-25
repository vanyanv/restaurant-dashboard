import type { ReactNode } from "react"
import type { DeltaTone } from "./figure"
import { Bullet } from "./bullet"
import { Spark } from "./spark"
import { bstat, bwords, isJudged, type Reference } from "@/lib/counter/bullet-state"

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
  value: ReactNode
  /** `.d` — how it moved, and anything bought to move it. */
  detail?: ReactNode
  /**
   * `.d`'s class.
   *
   * `.headline .d` had no tone at all until the ported sheet was corrected:
   * one rule painting `var(--good)`, so a net sales figure down 37.2% printed
   * its ▼ in the colour of a rise, and "no comparison set" printed as
   * good news beside it. The repair is a CORRECTIONS entry in
   * `scripts/extract-prototype-css.ts` covering this selector and `.mhead .d`
   * together — the desk and the phone must not disagree about what a fall
   * looks like.
   *
   * SENTIMENT, NOT DIRECTION. The prototype writes `mkt.d > 0 ? 'is-down'` on
   * one figure and `rep.d < 0 ? 'is-down'` on another on the same page, and
   * puts it on a figure with no direction at all (line 4776). The caller
   * decides; a figure whose fall is a win never gets it. Unclassed is a rise.
   */
  detailTone?: DeltaTone
  /**
   * The trajectory behind the figure, drawn between `.v` and `.d` exactly
   * where `strip()` draws a cell's — the prototype's `.fig` order is `k`, `v`,
   * `sp`, `d`, `blt`, `hfloor`, and a lead figure is the same six spans at
   * headline scale. Fewer than two points draws nothing.
   */
  series?: number[]
  /**
   * What this figure is read against, drawn as a `blt--lead` meter.
   *
   * A BAND is a range the figure usually sits in; a TARGET is a line somebody
   * published. `Figure` derives the same meter from the same type for a strip
   * cell — this is that shape at lead scale, without the `.fig` wrapper, which
   * `HeadBlock` owns.
   */
  reference?: Reference
  /**
   * `.hfloor` — the words under the meter, the lead-scale twin of a strip
   * cell's `.band`. The flag ("over" / "under" / "at the edge") is PREPENDED
   * from the reference's own verdict rather than written by the caller, so a
   * caption cannot say "of room" over a meter drawn in breach.
   */
  caption?: string
  /**
   * Emitted after `.d`, inside the same `.fig` — for a meter whose caption is
   * a judgement it has to make itself, which is `FloorMeter` and nothing else.
   * Mutually exclusive with `reference` in practice; both would draw two
   * meters under one figure.
   */
  meter?: ReactNode
}

/**
 * The three spans (and optional meter) inside one `.fig`, WITHOUT the `.fig`
 * itself — `HeadBlock` owns that element and its `fig--co` modifier.
 *
 * Split out of `HeadBlock` in Phase C. `figures` used to be `HeadFigure[]`,
 * which forced every lead figure on a page to have loaded before ANY of them
 * could be written: the two on Overview come from two different rollups
 * (`getAllStoresPnL` and `getSplhSeries`) that fail independently, so a single
 * array of plain data cannot express "net sales is here and sales per labour
 * hour is not". `figures` is now a list of NODES, each of which the caller
 * wraps in its own `<Section bare>`, so each figure carries its own state and
 * `HeadBlock` still owns the element, the modifier and the count.
 */
export function LeadFigure({
  label,
  value,
  detail,
  detailTone,
  series,
  reference,
  caption,
  meter,
}: HeadFigure) {
  const judged = reference != null && isJudged(reference)
  // `quiet` draws the meter but says nothing about it — no flag words, and no
  // breach tint on the sparkline above it.
  const spoken = judged && !reference.quiet
  const flag = spoken ? bwords(reference) : null
  const breach = spoken && bstat(reference) === "breach"

  return (
    <>
      <span className="k">{label}</span>
      <span data-figure-value className="v">
        {value}
      </span>
      {series ? <Spark series={series} breach={breach} /> : null}
      {detail ? (
        <span className={detailTone ? `d ${detailTone}` : "d"}>{detail}</span>
      ) : null}
      {judged ? <Bullet reference={reference} className="blt--lead" /> : null}
      {/* The prototype's `c[4] || r`: a reference alone is enough to open the
          band, even a quiet one that puts nothing in it. */}
      {caption || reference ? (
        <span className="hfloor">
          {flag ? (
            <>
              <span className={`flag is-${flag.status}`}>
                <i />
                {flag.word}
              </span>{" "}
            </>
          ) : null}
          {caption}
        </span>
      ) : null}
      {meter}
    </>
  )
}

export function HeadBlock({
  figures,
  children,
}: {
  /**
   * One node per lead figure — normally a `LeadFigure`, or a `Section bare`
   * that renders one once its own data arrives. `HeadBlock` wraps each in the
   * `.fig` element, so the number of figures still decides `--duo` and
   * `fig--co`; a caller cannot pass two and forget the class.
   */
  figures: ReactNode[]
  /** The verdict — a `Say`. The prototype's headline always carries one. */
  children: ReactNode
}) {
  const duo = figures.length === 2

  return (
    <div className={duo ? "headline headline--duo" : "headline"}>
      {figures.map((f, i) => (
        <div key={i} className={duo && i === 1 ? "fig fig--co" : "fig"}>
          {f}
        </div>
      ))}
      {children}
    </div>
  )
}
