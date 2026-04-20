import { cn } from "@/lib/utils"
import type { Period, PnLRow } from "@/lib/pnl"
import { Sparkline } from "./sparkline"
import { DeltaStamp } from "./delta-stamp"

/**
 * Full P&L statement as an N-column matrix. Rows = GL lines, columns = periods
 * (oldest leftmost, most-recent rightmost, highlighted). Trailing columns:
 *  - Trend: sparkline across all N periods
 *  - Δ: change from first period to last (or latest-vs-prior when only 2)
 *
 * Intentionally dense. The typography does the heavy lifting: Fraunces italic
 * subtotals with a top hairline, DM Sans uppercase labels, JetBrains Mono
 * tabular numbers. Horizontal scroll kicks in when N × column-width exceeds
 * viewport; first and last columns are sticky.
 */
export interface PnLStatementProps {
  rows: PnLRow[]
  periods: Period[]
  /** Section title rendered above the table (Fraunces display). Optional. */
  title?: string
  /** Extra classname on the outer container. */
  className?: string
  /** When true (default), show the Trend sparkline column. */
  showTrend?: boolean
  /** When true (default), show the Δ column. */
  showDelta?: boolean
}

function formatDollar(v: number, { parens = true } = {}): string {
  if (!Number.isFinite(v)) return "—"
  if (v === 0) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? (parens ? `(${str})` : `-$${str}`) : `$${str}`
}

function formatPercent(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "—"
  return `${(p * 100).toFixed(1)}%`
}

function formatPeriodLabel(p: Period): { primary: string; secondary: string } {
  // Periods come with a single label ("Mon Apr 14", "Apr 7 — Apr 13", "Apr 2026").
  // Split on em-dash/en-dash into a two-line header where possible.
  const dashMatch = p.label.match(/\s[—–]\s/)
  if (dashMatch) {
    const [a, b] = p.label.split(dashMatch[0])
    return { primary: b.trim(), secondary: a.trim() }
  }
  // Daily: "Mon Apr 14" → primary "Apr 14", secondary "Mon"
  const dayMatch = p.label.match(/^(\w{3})\s+(.+)$/)
  if (dayMatch) {
    return { primary: dayMatch[2], secondary: dayMatch[1] }
  }
  return { primary: p.label, secondary: "" }
}

export function PnLStatement({
  rows,
  periods,
  title,
  className,
  showTrend = true,
  showDelta = true,
}: PnLStatementProps) {
  if (periods.length === 0 || rows.length === 0) {
    return (
      <section className={cn("financial-statement financial-statement--empty", className)}>
        {title ? <h2 className="financial-statement__title">{title}</h2> : null}
        <p className="financial-statement__empty">No data for the selected period.</p>
      </section>
    )
  }

  const latestIdx = periods.length - 1
  const priorIdx = periods.length >= 2 ? periods.length - 2 : null
  const firstIdx = 0

  // For the Δ column: when there are many periods (3+), show first → last.
  // When there are exactly 2, prior → latest. When there's 1, suppress.
  const deltaFrom = periods.length >= 3 ? firstIdx : priorIdx
  const canShowDelta = showDelta && deltaFrom != null

  const templateCols = [
    "minmax(240px, 1.4fr)",
    ...periods.map((_, i) => (i === latestIdx ? "minmax(90px, 1.1fr)" : "minmax(80px, 1fr)")),
    showTrend ? "90px" : null,
    canShowDelta ? "minmax(100px, 0.9fr)" : null,
  ].filter(Boolean).join(" ")

  const totalCols = 1 + periods.length + (showTrend ? 1 : 0) + (canShowDelta ? 1 : 0)

  return (
    <section className={cn("financial-statement", className)}>
      {title ? <h2 className="financial-statement__title font-display">{title}</h2> : null}

      <div className="financial-statement__scroll">
        <div
          className="financial-statement__grid"
          style={{ gridTemplateColumns: templateCols }}
          role="table"
          aria-label={title ?? "P&L statement"}
        >
          {/* Header row */}
          <div className="statement-cell statement-cell--head statement-cell--label" role="columnheader">
            <span className="statement-head-kicker">Account</span>
          </div>
          {periods.map((p, i) => {
            const { primary, secondary } = formatPeriodLabel(p)
            return (
              <div
                key={p.label + i}
                className={cn(
                  "statement-cell statement-cell--head statement-cell--num",
                  i === latestIdx && "statement-cell--latest"
                )}
                role="columnheader"
              >
                {secondary ? <span className="statement-head-kicker">{secondary}</span> : null}
                <span className="statement-head-label">{primary}</span>
              </div>
            )
          })}
          {showTrend ? (
            <div className="statement-cell statement-cell--head statement-cell--num" role="columnheader">
              <span className="statement-head-kicker">Trend</span>
            </div>
          ) : null}
          {canShowDelta ? (
            <div className="statement-cell statement-cell--head statement-cell--num" role="columnheader">
              <span className="statement-head-kicker">
                {periods.length >= 3 ? "Δ First → Latest" : "Δ vs Prior"}
              </span>
            </div>
          ) : null}

          {rows.flatMap((row) => {
            const cells: React.ReactNode[] = []
            const isCostRow = row.code.startsWith("COM_") || row.isFixed || row.code === "6100"

            cells.push(
              <div
                key={`${row.code}-label`}
                className={cn(
                  "statement-cell statement-cell--label",
                  row.isSubtotal && "statement-cell--subtotal"
                )}
                role="rowheader"
              >
                <span className={cn("statement-label", row.isSubtotal && "font-display-tight")}>
                  {row.label}
                </span>
              </div>
            )

            for (let i = 0; i < periods.length; i++) {
              const v = row.values[i] ?? 0
              const unknown = row.isUnknown?.[i] === true
              cells.push(
                <div
                  key={`${row.code}-${i}`}
                  className={cn(
                    "statement-cell statement-cell--num",
                    row.isSubtotal && "statement-cell--subtotal",
                    i === latestIdx && "statement-cell--latest"
                  )}
                  role="cell"
                >
                  {unknown ? (
                    <span className="statement-unknown" title="Not configured">—</span>
                  ) : (
                    <span className="font-mono">{formatDollar(v)}</span>
                  )}
                </div>
              )
            }

            if (showTrend) {
              const hasData = row.values.some((v) => Number.isFinite(v) && v !== 0)
              cells.push(
                <div
                  key={`${row.code}-trend`}
                  className={cn(
                    "statement-cell statement-cell--num statement-cell--trend",
                    row.isSubtotal && "statement-cell--subtotal"
                  )}
                  role="cell"
                >
                  {hasData ? (
                    <Sparkline
                      values={row.values}
                      width={72}
                      height={18}
                      showZero={row.values.some((v) => v < 0)}
                      ariaLabel={`${row.label} trend across ${periods.length} periods`}
                    />
                  ) : (
                    <span className="statement-unknown">—</span>
                  )}
                </div>
              )
            }

            if (canShowDelta) {
              const current = row.values[latestIdx] ?? 0
              const prior = row.values[deltaFrom!] ?? null
              cells.push(
                <div
                  key={`${row.code}-delta`}
                  className={cn(
                    "statement-cell statement-cell--num statement-cell--delta",
                    row.isSubtotal && "statement-cell--subtotal"
                  )}
                  role="cell"
                >
                  <DeltaStamp
                    current={current}
                    prior={prior}
                    format="dollars"
                    costSemantics={isCostRow}
                    size="sm"
                  />
                </div>
              )
            }

            return cells
          })}
        </div>
      </div>
    </section>
  )
}
