/**
 * A ranked bar list: a label, a proportional bar, a figure.
 *
 * Ported from `askBars()` at line 8519 of
 * `docs/counter/counter-prototype.html`. `.rankbar` and its four children
 * already carry rules in the generated sheet (lines 607–612) and nothing
 * rendered them until this file — the same situation `.donut` and `.mtx` were
 * in, and the last of the three.
 *
 * ## The bar is relative to the LARGEST row, not to 100
 *
 * The prototype divides each row by the maximum, so the biggest bar always
 * fills the track. That is right for a ranking — the question is which row is
 * biggest and by how much — and it is why this is not a stacked meter. A set
 * of shares that happen to sum to 100 still draws the largest one full width.
 *
 * The 2% floor is the prototype's and is kept: a row worth almost nothing
 * still needs a visible mark, or it reads as a row with no bar rather than a
 * row with a small one.
 */
export interface RankBar {
  /** `.lb` — what the row is. */
  label: string
  /** `.vv` — the figure, pre-formatted. */
  value: string
  /** What the bar's length is proportional to. Negative values use magnitude. */
  weight: number
  /**
   * A `ct-` band token NAME, without the `--` (`"mx-2"`, `"gp-1"`). Resolved
   * to `var(--…)` here so a caller never writes a colour, which
   * `no-colour-literal` would fail. Omitted leaves the sheet's own `--ink`.
   */
  tone?: string
}

export function RankBars({ rows }: { rows: RankBar[] }) {
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.weight)), 0)

  return (
    <div className="rankbar">
      {rows.map((r) => (
        <div className="r" key={r.label}>
          <span className="lb">{r.label}</span>
          <span className="tr">
            <i
              style={{
                width: `${Math.max(2, Math.round((Math.abs(r.weight) / (max || 1)) * 100))}%`,
                ...(r.tone ? { background: `var(--${r.tone})` } : {}),
              }}
            />
          </span>
          <span className="vv">{r.value}</span>
        </div>
      ))}
    </div>
  )
}
