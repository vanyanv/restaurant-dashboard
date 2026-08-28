/**
 * A stacked proportional bar and the legend that names its bands.
 *
 * Ported from `P.inventory.desk()` at line 5743 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="costbar" style="height:11px">
 *   <span style="width:64%;background:var(--good)"></span>
 *   …
 * </div>
 * <div class="costlegend">
 *   <div><i style="background:var(--good)"></i>Predicted within tolerance<b>22 items</b></div>
 *   …
 * </div>
 * ```
 *
 * `.costbar` and its five sibling rules
 * (`src/styles/counter-components.css:859-864`) carry the whole treatment —
 * the 1px gaps between bands, the legend's swatch, the right-aligned tabular
 * count — and **nothing in this tree emitted any of them until this file**, the
 * same situation `.mdot`, `.rankbar` and `.held` were in.
 *
 * ## Why this is not `RankBars` or `Meter`
 *
 * `RankBars` draws one track PER ROW, each scaled to the largest — a ranking.
 * This is ONE track split into bands that sum to the whole, which is a
 * different claim: not "this is the biggest" but "this is all of it, and here
 * is how it divides". `Meter` is a single fill against a fixed domain. The
 * three marks are in the sheet separately because they answer three questions.
 *
 * ## The zero band still renders
 *
 * A band worth nothing keeps its legend row and gets no width. Dropping it
 * would make "no items are undefined" and "we do not track whether items are
 * undefined" look identical, and the second is what an empty legend means
 * everywhere else in this design.
 */
export interface CostBand {
  key: string
  label: string
  /** How many, already written — "59 items", "$1,204". */
  value: string
  /** What the band's width is proportional to. */
  weight: number
  /**
   * A `ct-` token NAME without the `--` ("good", "signal", "bad"). Resolved to
   * `var(--…)` here so a caller never writes a colour, which `no-colour-literal`
   * would fail.
   */
  tone: string
}

export function CostBar({ bands, height = 11 }: { bands: CostBand[]; height?: number }) {
  const total = bands.reduce((t, b) => t + Math.max(0, b.weight), 0)

  return (
    <>
      <div className="costbar" style={{ height }}>
        {bands.map((b) => (
          <span
            key={b.key}
            style={{
              width: total > 0 ? `${(Math.max(0, b.weight) / total) * 100}%` : "0%",
              background: `var(--${b.tone})`,
            }}
          />
        ))}
      </div>
      <div className="costlegend" style={{ marginTop: 11 }}>
        {bands.map((b) => (
          <div key={b.key}>
            <i style={{ background: `var(--${b.tone})` }} />
            {b.label}
            <b>{b.value}</b>
          </div>
        ))}
      </div>
    </>
  )
}
