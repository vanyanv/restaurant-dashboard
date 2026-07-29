"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { Period, PnLRow } from "@/lib/pnl"
import { COGS_CODE, LABOR_CODE, AFTER_LABOR_RENT_CODE, GROSS_PROFIT_CODE } from "@/lib/pnl"
import { Sparkline } from "./sparkline"
import { DeltaStamp } from "./delta-stamp"

/**
 * Full P&L statement as an N-column matrix. Rows = GL lines, columns = periods
 * (oldest leftmost, most-recent rightmost, highlighted). Trailing columns:
 *  - Trend: sparkline across all N periods
 *  - Δ: change between the first and last COMPLETE periods — partial buckets
 *    at the range edges are never used as delta endpoints (comparing a 4-day
 *    fragment to a 3-day fragment reads as decline when nothing declined).
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
  /** Rendered right of the title, on the same baseline — page verbs live here. */
  actions?: React.ReactNode
  /** Extra classname on the outer container. */
  className?: string
  /** When true (default), show the Trend sparkline column. */
  showTrend?: boolean
  /** When true (default), show the Δ column. */
  showDelta?: boolean
}

/** % of sales sub-lines + over-target detection, keyed by row code.
 *  A cost row only earns red when it exceeds its target — at rest, costs
 *  are ink like everything else ("earn the red"). */
const PCT_ROWS: Record<string, { target?: number }> = {
  [COGS_CODE]: { target: 0.22 },
  [LABOR_CODE]: { target: 0.28 },
  [GROSS_PROFIT_CODE]: {},
  [AFTER_LABOR_RENT_CODE]: {},
}

function formatDollar(v: number, { parens = true } = {}): string {
  if (!Number.isFinite(v)) return "—"
  if (v === 0) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? (parens ? `(${str})` : `-$${str}`) : `$${str}`
}

/** Deduction-style format: always shows magnitude in parens, regardless of
 *  storage sign. Used for cost rows where the accounting meaning is always
 *  "subtract". */
function formatDeduction(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return `(${str})`
}

/** Row codes where the semantic meaning is a DEDUCTION regardless of how
 *  the value is stored (some are stored as negatives, some as positive
 *  magnitudes). Used for parens formatting and delta cost-semantics. */
const DEDUCTION_CODES = new Set<string>([
  "COM_UBER", // 3P commissions
  "COM_DD",
  "6100",     // COGS
  "6200",     // Labor
  "7200",     // Rent
  "7210",     // Cleaning
  "7220",     // Towels
  "4110",     // Discounts (guest)
])

function isDeductionRow(row: PnLRow): boolean {
  // Custom owner-managed fixed expenses (code `FX_*`) are stored negative and
  // flagged isFixed; format them as deductions like Labor/Rent/Towels.
  return DEDUCTION_CODES.has(row.code) || row.isFixed === true
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

/** A period is a valid delta endpoint only when it covers its full bucket AND
 *  has fully elapsed. Daily buckets are built with isPartial=false even for
 *  today-in-progress, so the elapsed check matters for all granularities. */
function isCompletePeriod(p: Period, todayYMD: string): boolean {
  if (p.isPartial) return false
  return p.endDate.toISOString().slice(0, 10) < todayYMD
}

/** A row is inactive when it will never say anything for this range: not a
 *  subtotal, not "unknown / needs configuring", and zero in every period. */
function isInactiveRow(row: PnLRow): boolean {
  if (row.isSubtotal) return false
  if (row.isUnknown?.some(Boolean)) return false
  return row.values.every((v) => !Number.isFinite(v) || v === 0)
}

export function PnLStatement({
  rows,
  periods,
  title,
  actions,
  className,
  showTrend = true,
  showDelta = true,
}: PnLStatementProps) {
  const [showInactive, setShowInactive] = useState(false)

  if (periods.length === 0 || rows.length === 0) {
    return (
      <section className={cn("financial-statement financial-statement--empty", className)}>
        {title ? (
          <div className="financial-statement__head">
            <h2 className="financial-statement__title">{title}</h2>
            {actions ? <div className="financial-statement__actions">{actions}</div> : null}
          </div>
        ) : null}
        <p className="financial-statement__empty">No data for the selected period.</p>
      </section>
    )
  }

  const latestIdx = periods.length - 1

  // Δ endpoints: first and last COMPLETE periods. With fewer than two complete
  // periods there is nothing honest to compare, so the column disappears.
  const todayYMD = new Date().toLocaleDateString("en-CA")
  const completeIdxs = periods
    .map((p, i) => (isCompletePeriod(p, todayYMD) ? i : null))
    .filter((i): i is number => i != null)
  const deltaFrom = completeIdxs.length >= 2 ? completeIdxs[0] : null
  const deltaTo = completeIdxs.length >= 2 ? completeIdxs[completeIdxs.length - 1] : null
  const canShowDelta = showDelta && deltaFrom != null && deltaTo != null && deltaFrom !== deltaTo
  const deltaSkipsPartials = canShowDelta && (deltaFrom !== 0 || deltaTo !== latestIdx)

  const inactiveRows = rows.filter(isInactiveRow)
  const collapsing = !showInactive && inactiveRows.length >= 2
  const inactiveSet = collapsing ? new Set(inactiveRows.map((r) => r.code)) : null
  const firstInactiveCode = inactiveRows[0]?.code

  const templateCols = [
    "minmax(240px, 1.4fr)",
    ...periods.map((_, i) => (i === latestIdx ? "minmax(90px, 1.1fr)" : "minmax(80px, 1fr)")),
    showTrend ? "90px" : null,
    canShowDelta ? "minmax(100px, 0.9fr)" : null,
  ].filter(Boolean).join(" ")

  const isDailyFirehose = periods.length > 35 && periods[0]?.days === 1

  // Rhythm rule: a slightly bolder hairline every 4th data row (resets at each
  // subtotal) so the eye can track a row across all N columns without a hover.
  let sinceRule = 0

  return (
    <section className={cn("financial-statement", className)}>
      {title || actions ? (
        <div className="financial-statement__head">
          {title ? <h2 className="financial-statement__title font-display">{title}</h2> : null}
          {actions ? <div className="financial-statement__actions">{actions}</div> : null}
        </div>
      ) : null}

      {isDailyFirehose ? (
        <p className="statement-note">
          {periods.length} daily columns — Week granularity reads tighter over a range this long.
        </p>
      ) : null}

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
            <div
              className="statement-cell statement-cell--head statement-cell--num"
              role="columnheader"
              title={
                deltaSkipsPartials
                  ? `Partial buckets excluded — compares ${periods[deltaFrom!].label} to ${periods[deltaTo!].label}`
                  : undefined
              }
            >
              <span className="statement-head-kicker">
                Δ full periods{deltaSkipsPartials ? " *" : ""}
              </span>
            </div>
          ) : null}

          {rows.flatMap((row) => {
            // Collapsed inactive rows: one toggle line where the first one sat.
            if (inactiveSet?.has(row.code)) {
              if (row.code !== firstInactiveCode) return []
              return [
                <div key="inactive-toggle" className="statement-collapse" role="row">
                  <button
                    type="button"
                    className="statement-collapse__btn"
                    onClick={() => setShowInactive(true)}
                  >
                    {inactiveRows.length} inactive accounts — show
                  </button>
                </div>,
              ]
            }

            const cells: React.ReactElement[] = []
            const isCostRow = isDeductionRow(row)
            const pctSpec = PCT_ROWS[row.code]

            if (row.isSubtotal) {
              sinceRule = 0
            } else {
              sinceRule += 1
            }
            const ruled = !row.isSubtotal && sinceRule > 0 && sinceRule % 4 === 0

            const rowClasses = cn(
              row.isSubtotal && "statement-cell--subtotal",
              isCostRow && "statement-cell--cost",
              ruled && "statement-cell--rule"
            )

            cells.push(
              <div
                key={`${row.code}-label`}
                className={cn("statement-cell statement-cell--label", rowClasses)}
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
              // Red is earned, not categorical: a losing subtotal reads red,
              // and a % row over its target reads red. A cost being a cost
              // does not.
              const isNegativeValue = Number.isFinite(v) && v < 0
              const losingSubtotal = row.isSubtotal && isNegativeValue
              const pct = pctSpec ? Math.abs(row.percents[i] ?? 0) : null
              const overTarget =
                pctSpec?.target != null && pct != null && pct > pctSpec.target + 0.0005
              const display = isCostRow ? formatDeduction(v) : formatDollar(v)
              cells.push(
                <div
                  key={`${row.code}-${i}`}
                  className={cn(
                    "statement-cell statement-cell--num",
                    rowClasses,
                    i === latestIdx && "statement-cell--latest",
                    losingSubtotal && "statement-cell--deduction",
                    overTarget && "statement-cell--over"
                  )}
                  role="cell"
                >
                  {unknown ? (
                    <span className="statement-unknown" title="Not configured">—</span>
                  ) : (
                    <>
                      <span className="font-mono">{display}</span>
                      {pctSpec && pct != null && pct !== 0 && v !== 0 ? (
                        <span
                          className="statement-pct font-mono"
                          title={
                            pctSpec.target != null
                              ? `${(pct * 100).toFixed(1)}% of sales · target ${(pctSpec.target * 100).toFixed(0)}%`
                              : `${(pct * 100).toFixed(1)}% of sales`
                          }
                        >
                          {(pct * 100).toFixed(1)}%
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              )
            }

            if (showTrend) {
              const hasData = row.values.some((v) => Number.isFinite(v) && v !== 0)
              cells.push(
                <div
                  key={`${row.code}-trend`}
                  className={cn("statement-cell statement-cell--num statement-cell--trend", rowClasses)}
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
              const current = row.values[deltaTo!] ?? 0
              const prior = row.values[deltaFrom!] ?? null
              cells.push(
                <div
                  key={`${row.code}-delta`}
                  className={cn("statement-cell statement-cell--num statement-cell--delta", rowClasses)}
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

          {showInactive && inactiveRows.length >= 2 ? (
            <div className="statement-collapse" role="row">
              <button
                type="button"
                className="statement-collapse__btn"
                onClick={() => setShowInactive(false)}
              >
                hide {inactiveRows.length} inactive accounts
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
