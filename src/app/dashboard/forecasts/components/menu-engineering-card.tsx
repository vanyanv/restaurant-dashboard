"use client"

import type {
  MenuEngineeringData,
  MenuEngineeringRow,
  MenuQuadrant,
} from "@/app/actions/forecasts/menu-engineering-actions"

interface Props {
  data: MenuEngineeringData
}

const QUADRANT_LABEL: Record<MenuQuadrant, string> = {
  STAR: "Stars",
  PLOWHORSE: "Plowhorses",
  PUZZLE: "Puzzles",
  DOG: "Dogs",
}

const QUADRANT_BLURB: Record<MenuQuadrant, string> = {
  STAR: "high margin · high volume",
  PLOWHORSE: "low margin · high volume",
  PUZZLE: "high margin · low volume",
  DOG: "low margin · low volume",
}

const QUADRANT_CLASS: Record<MenuQuadrant, string> = {
  STAR: "text-[var(--ink)] font-semibold",
  PLOWHORSE: "text-[var(--ink)]",
  PUZZLE: "text-[var(--ink-muted)]",
  DOG: "text-[var(--accent)]",
}

function fmtUsd(n: number, max = 0) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtNum(n: number) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function MenuEngineeringCard({ data }: Props) {
  if (data.rows.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Menu engineering</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            no costed items in window
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          Need at least a few costed-recipe items with sales in the window
          (DailyCogsItem rollup). Check ingredient mappings on /dashboard/cogs.
        </div>
      </section>
    )
  }

  // Rank items within each quadrant by total contribution; show top 5 per.
  const buckets: Record<MenuQuadrant, MenuEngineeringRow[]> = {
    STAR: [],
    PLOWHORSE: [],
    PUZZLE: [],
    DOG: [],
  }
  for (const r of data.rows) buckets[r.quadrant].push(r)
  for (const q of Object.keys(buckets) as MenuQuadrant[]) {
    buckets[q].sort((a, b) => b.totalContribution - a.totalContribution)
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">
          Menu engineering · last{" "}
          {Math.round(
            (data.windowEnd.getTime() - data.windowStart.getTime()) / 86_400_000,
          )}
          d
        </span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>
            median qty ·{" "}
            <span className="normal-case tracking-normal">
              {fmtNum(data.medianVelocity)}
            </span>
          </span>
          <span>·</span>
          <span>
            median margin ·{" "}
            <span className="normal-case tracking-normal">
              {fmtUsd(data.medianUnitMargin, 2)}
            </span>
          </span>
          <span>·</span>
          <span>
            contribution ·{" "}
            <span className="normal-case tracking-normal">
              {fmtUsd(data.totalContribution)}
            </span>
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px bg-[var(--hairline)]">
        {(Object.keys(QUADRANT_LABEL) as MenuQuadrant[]).map((q) => {
          const items = buckets[q]
          return (
            <div key={q} className="bg-[var(--paper)] p-5">
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div
                    className={`font-mono text-[11px] uppercase tracking-[0.18em] ${QUADRANT_CLASS[q]}`}
                  >
                    {QUADRANT_LABEL[q]} · {data.counts[q]}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    {QUADRANT_BLURB[q]}
                  </div>
                </div>
              </div>
              {items.length === 0 ? (
                <div className="text-[12px] text-[var(--ink-faint)]">No items</div>
              ) : (
                <ul className="space-y-1">
                  {items.slice(0, 5).map((r) => (
                    <li
                      key={r.itemName}
                      className="grid grid-cols-[1fr_auto_auto] gap-3 items-baseline text-[12px]"
                    >
                      <span className="text-[var(--ink)] truncate" title={r.itemName}>
                        {r.itemName}
                      </span>
                      <span
                        className="text-[var(--ink-muted)] tabular-nums text-right"
                        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                      >
                        {fmtNum(r.soldQty)}
                      </span>
                      <span
                        className="text-[var(--ink)] tabular-nums text-right"
                        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                      >
                        {fmtUsd(r.totalContribution)}
                      </span>
                    </li>
                  ))}
                  {items.length > 5 && (
                    <li className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)] pt-1">
                      +{items.length - 5} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
