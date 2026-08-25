import type { ReactNode } from "react"

/**
 * One overshoot, split into what made it.
 *
 * Ported from `gapbar()` at line 4068 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="gap">
 *   <div class="gap__ends">
 *     <span><em>Plan</em><b>29.0%</b></span>
 *     <span class="mid">2.4 points over</span>
 *     <span class="hi"><em>Aug 1 – Aug 24</em><b>31.4%</b></span>
 *   </div>
 *   <div class="gap__bar"><i style="width:…;background:var(--gp-1)"></i>…</div>
 *   <dl class="gap__key">
 *     <div><dt><i style="background:var(--gp-1)"></i>Ground beef</dt>
 *          <dd>1.4 pts</dd><span>why</span></div>…
 *   </dl>
 *   <p class="gap__sum">1.4 + 0.7 + 0.3 = 2.4. …</p>
 * </div>
 * ```
 *
 * TWO THINGS THE TYPE ENFORCES, BECAUSE THE PROTOTYPE ONLY ASSERTS THEM IN
 * PROSE:
 *
 *  1. **The residual is derived, never passed.** The prototype's own footnote
 *     says the third cause "is the gap minus the other two — if a cause is
 *     missing it is inside *everything else*, not outside the total". That is
 *     only true if nobody can type a number into it, so `residual` carries a
 *     name and an explanation and no figure: its size is
 *     `(actual − plan) − Σ causes`, computed here. A decomposition that does
 *     not add up cannot be expressed.
 *  2. **A cause's colour is its own, not its rank.** `tone` is declared per
 *     cause by the caller and is fixed to that cause forever. Note 35's ramp
 *     is sequential, so if it were assigned by size, a range where the channel
 *     mix outran the beef would repaint both segments and the reader would
 *     believe something changed colour-coded categories. `tests/…/gap-bar`
 *     asserts that sorting the causes by size leaves every swatch where it was.
 *
 * The `--gp-*` ramp is the ported sheet's; this file writes no colour.
 */
export type GapTone = "gp-1" | "gp-2" | "gp-3"

export interface GapCause {
  name: string
  /** Points of the overshoot this cause carries. Signed — a cause can pull the other way. */
  points: number
  /** Fixed to the cause, not to its size. */
  tone: GapTone
  /** The sentence under the figure: how this cause was measured. */
  why: ReactNode
}

/** The unexplained remainder. Named and explained, never sized by the caller. */
export interface GapResidual {
  name: string
  tone: GapTone
  why: ReactNode
}

export function GapBar({
  plan,
  actual,
  rangeLabel,
  causes,
  residual,
}: {
  /** The published target, in points (e.g. 29.0). */
  plan: number
  /** What the range actually read, in points (e.g. 31.4). */
  actual: number
  /** What the right-hand figure is labelled with — the range, not "actual". */
  rangeLabel: string
  causes: GapCause[]
  residual: GapResidual
}) {
  const gap = round1(actual - plan)
  const named = round1(causes.reduce((t, c) => t + c.points, 0))
  // Derived, so the parts cannot disagree with the total they explain.
  const parts: GapCause[] = [...causes, { ...residual, points: round1(gap - named) }]

  // Only positive parts take width: a cause pulling the other way shortens no
  // segment, it is reported in the key. `0.01` keeps a division by zero out of
  // a range where every cause is zero or negative.
  const total = Math.max(
    0.01,
    parts.reduce((t, p) => t + Math.max(0, p.points), 0),
  )

  const sum = parts.map((p) => signed(p.points)).join(" + ")

  return (
    <div className="gap">
      <div className="gap__ends">
        <span>
          <em>Plan</em>
          <b>{plan.toFixed(1)}%</b>
        </span>
        {/* The prototype only ever renders an overshoot. A range that comes in
            UNDER plan is a real state and "−1.0 points over" is not a sentence,
            so the direction is written out rather than carried by a sign. */}
        <span className="mid">
          {gap >= 0
            ? `${gap.toFixed(1)} points over`
            : `${Math.abs(gap).toFixed(1)} points under`}
        </span>
        <span className="hi">
          <em>{rangeLabel}</em>
          <b>{actual.toFixed(1)}%</b>
        </span>
      </div>

      <div className="gap__bar">
        {parts.map((p) => (
          <i
            key={p.name}
            style={{
              width: `${((Math.max(0, p.points) / total) * 100).toFixed(2)}%`,
              background: `var(--${p.tone})`,
            }}
          />
        ))}
      </div>

      <dl className="gap__key">
        {parts.map((p) => (
          <div key={p.name}>
            <dt>
              <i style={{ background: `var(--${p.tone})` }} />
              {p.name}
            </dt>
            <dd>{signed(p.points)} pts</dd>
            <span>{p.why}</span>
          </div>
        ))}
      </dl>

      <p className="gap__sum">
        {sum} = {gap.toFixed(1)}. They add to the gap because the last one is
        the gap minus the others — if a cause is missing it is inside{" "}
        <em>{residual.name.toLowerCase()}</em>, not outside the total.
      </p>
    </div>
  )
}

/** U+2212 MINUS, not a hyphen: this sits in a row of figures. */
function signed(v: number): string {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
