import { Tag } from "./tag"
import type { Tone } from "./tone"

/**
 * `.ro` — the shelf against the week, two readings of it at once.
 *
 * Every row draws the SAME on-hand quantity consumed two ways: the grey bar is
 * the flat fourteen-day trailing rate the product ships today, the coloured
 * bar is the same stock consumed at the week's own forecast demand. The
 * vertical marker on both is lead time plus safety — the point past which
 * ordering is already late.
 *
 * The stack is the argument. A row where the two bars are the same length is a
 * row where the trailing average happened to be right; a row where the
 * coloured bar stops short of the marker while the grey one clears it is an
 * order today's product would have let the owner miss. See
 * `src/lib/counter/run-out.ts` and `src/lib/inventory/forecast-depletion.ts`.
 *
 * Bars are `width` set inline from the data and `scaleX` animated from zero
 * (tier 3, once, on the compositor). A row that has just crossed into "order
 * now" carries `justwent`, which is tier 2's one-shot red ring.
 */

export interface RunOutBarRow {
  key: string
  name: string
  meta: string
  store: string | null
  flatCoverDays: number | null
  forecastCoverDays: number | null
  extrapolated: boolean
  reorderLineDays: number
  outLabel: string
  qty: string
  tag: string
  tagTone: Tone
  href: string
}

function pct(days: number | null, scale: number): number {
  if (days === null) return 0
  return Math.max(0, Math.min(100, (days / scale) * 100))
}

function d1(v: number | null): string {
  return v === null ? "—" : `${(Math.round(v * 10) / 10).toFixed(1)}d`
}

export function RunOut({
  rows,
  scaleDays,
}: {
  rows: RunOutBarRow[]
  /** The bar's full span in days. A row with more cover than this fills it. */
  scaleDays: number
}) {
  return (
    <div className="ro">
      {rows.map((r) => {
        const markerPct = pct(r.reorderLineDays, scaleDays)
        const fill =
          r.tagTone === "bad" ? "cbar fc badfill" : r.tagTone === "warn" ? "cbar fc warnfill" : "cbar fc"
        return (
          <div className="rorow" key={r.key}>
            <div className="nm">
              <b>{r.name}</b>
              <span>{r.store ? `${r.meta} · ${r.store}` : r.meta}</span>
            </div>
            <div className="cover">
              <div className="cbar flat">
                <i style={{ width: `${pct(r.flatCoverDays, scaleDays)}%` }} />
                <span className="lead-marker" style={{ left: `${markerPct}%` }} />
              </div>
              <div className={fill}>
                <i style={{ width: `${pct(r.forecastCoverDays, scaleDays)}%` }} />
                <span className="lead-marker" style={{ left: `${markerPct}%` }} />
              </div>
              <div className="cl">
                <span>
                  flat <b>{d1(r.flatCoverDays)}</b>
                </span>
                <span>
                  forecast <b>{d1(r.forecastCoverDays)}</b>
                  {r.extrapolated ? "+" : ""}
                </span>
              </div>
            </div>
            <div className={r.tagTone === "good" ? "out" : `out ${r.tagTone === "bad" ? "urgent" : "soon"}`}>
              <b>{r.outLabel}</b>
              {r.qty}
            </div>
            <div className="act">
              <Tag tone={r.tagTone}>{r.tag}</Tag>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The two bars named, once, above the rows. Without it the grey bar is a mystery. */
export function RunOutKey() {
  return (
    <div className="rokey">
      <span>
        <i style={{ background: "var(--line-strong)" }} /> Flat 14-day
      </span>
      <span>
        <i style={{ background: "var(--good)" }} /> Forecast-shaped
      </span>
      <span>
        <i className="is-rule" /> Lead + safety
      </span>
    </div>
  )
}
