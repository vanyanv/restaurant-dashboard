import type { PositionMixRow } from "@/app/actions/labor-productivity-actions"

const usd0 = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`

/**
 * Where the hours actually went. Salaried positions legitimately report zero
 * hours in Harri, so they're labelled rather than hidden — an invisible manager
 * line is how SPLH quietly overstates productivity.
 */
export function LaborPositionMix({ rows }: { rows: PositionMixRow[] }) {
  if (rows.length === 0) {
    return <p className="labor-empty">No position breakdown for this week.</p>
  }

  return (
    <div className="labor-mix">
      {rows.map((r) => (
        <div key={`${r.positionCode}-${r.categoryName ?? ""}`} className="labor-mix__row">
          <span className="labor-mix__name">
            {r.positionName}
            {r.categoryName ? <span className="labor-mix__cat">{r.categoryName}</span> : null}
          </span>
          <span className="labor-mix__nums">
            {r.hours > 0 ? (
              <>
                {r.hours.toFixed(1)} h · {usd0(r.cost)} ·{" "}
                {(r.shareOfHours * 100).toFixed(0)}%
              </>
            ) : (
              <span className="labor-score__muted">salaried · no hours reported</span>
            )}
          </span>
          <span className="labor-mix__bar">
            <span
              className="labor-mix__fill"
              style={{ width: `${Math.max(r.shareOfHours * 100, 0.5)}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}
