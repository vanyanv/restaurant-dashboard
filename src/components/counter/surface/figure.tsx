import { bstat, bwords, isJudged, type Reference } from "@/lib/counter/bullet-state"
import { Bullet } from "./bullet"
import { Spark } from "./spark"

/**
 * The delta's tone. Up is the default and needs no class — `.strip .d` is
 * already `var(--good)`. The prototype uses exactly these two overrides.
 */
export type DeltaTone = "is-down" | "is-flat"

export interface FigureProps {
  /** The prototype's `c[0]`. */
  label: string
  /** The prototype's `c[1]`. Pre-formatted — formatting belongs to `@/lib/counter/format`. */
  value: string
  /** `c[2]`. */
  delta?: string
  /** `c[3]` — the delta's class. */
  deltaTone?: DeltaTone
  /** `c[4]` — the words after the flag, inside the band. */
  caption?: string
  /** `c[5]` — what this figure is judged against, if anything. */
  reference?: Reference
  /** `lead` is the one headline figure on a page; the default is a strip cell. */
  size?: "lead" | "cell"
}

/**
 * One figure: what it is, what it reads, how it moved, and what it is being
 * judged against.
 *
 * The DOM is the prototype's, in the prototype's order — `strip()` at line
 * 3008 of `docs/counter/counter-prototype.html`:
 *
 *   <span class="k">    label
 *   <span class="v">    value
 *   <svg class="sp">    sparkline   — only when the reference carries a series
 *   <span class="d">    delta       — only when there is one
 *   <span class="blt">  bullet      — only when the reference has a band or a target
 *   <span class="band"> flag + caption
 *
 * (The brief's table omits `.v`; the prototype emits it second, immediately
 * after `.k`. The prototype wins.)
 *
 * A cell is a BARE `<div>` with no class — `.strip > div` is what styles it,
 * which is why `Strip` must be the thing that wraps these. A lead figure is
 * `<div class="fig">`, matching `headBlock()` at line 3692, and its band
 * becomes `.hfloor` to match `floorMeter()` at line 3793.
 *
 * `.v` carries no numeral utility of its own, and that is not an omission.
 * The prototype's value inherits `font-variant-numeric: tabular-nums
 * lining-nums` from its root, and `counter-components.css`'s `.ct-root` block
 * now declares exactly that — so a figure inside an `AppShell` aligns in a
 * column for the same reason the prototype's does, one declaration rather than
 * one per figure. `tests/styles/counter-components.test.ts` holds that
 * declaration in place.
 *
 * `Section` is the sole state renderer (R3). A `Figure` takes plain data and
 * knows nothing about loading, empty or failed.
 */
export function Figure({
  label,
  value,
  delta,
  deltaTone,
  caption,
  reference,
  size = "cell",
}: FigureProps) {
  const lead = size === "lead"
  const judged = reference != null && isJudged(reference)
  // `quiet` draws the meter but says nothing about it — no flag words, no
  // breach tint on the sparkline.
  const spoken = judged && !reference.quiet
  const flag = spoken ? bwords(reference) : null
  const breach = spoken && bstat(reference) === "breach"

  return (
    <div className={lead ? "fig" : undefined}>
      <span className="k">{label}</span>
      <span data-figure-value className="v">
        {value}
      </span>
      {reference?.series ? <Spark series={reference.series} breach={breach} /> : null}
      {delta ? <span className={deltaTone ? `d ${deltaTone}` : "d"}>{delta}</span> : null}
      {judged ? (
        <Bullet reference={reference} className={lead ? "blt--lead" : undefined} />
      ) : null}
      {/* The prototype's `c[4] || r`: a reference alone is enough to open the
          band, even a quiet one that puts nothing in it. */}
      {caption || reference ? (
        <span className={lead ? "hfloor" : "band"}>
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
    </div>
  )
}
