import Link from "next/link"
import { getCogsOperatorSummary } from "@/lib/cogs"
import type { CogsActionSeverity } from "@/lib/cogs"
import type { CogsFilters } from "./data"

function formatMoney(value: number): string {
  const abs = Math.abs(value)
  const text = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return value < 0 ? `-$${text}` : `$${text}`
}

function formatPct(value: number | null): string {
  if (value == null) return "set"
  return `${value.toFixed(1)}%`
}

function formatDelta(value: number | null): string {
  if (value == null) return "no baseline"
  if (value > 0) return `+${value.toFixed(1)}pp`
  if (value < 0) return `${value.toFixed(1)}pp`
  return "flat"
}

function severityLabel(severity: CogsActionSeverity): string {
  if (severity === "critical") return "fix"
  if (severity === "warning") return "watch"
  return "note"
}

export async function OperatorLedgerSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const summary = await getCogsOperatorSummary(
    storeId,
    filters.startDate,
    filters.endDate
  )
  const { kpis, dataQuality } = summary
  const overTarget = kpis.deltaVsTargetPp != null && kpis.deltaVsTargetPp > 0
  const hasData = kpis.revenueDollars > 0 || kpis.cogsDollars > 0

  return (
    <section className="cogs-operator-grid" aria-label="COGS operator brief">
      <div className="inv-panel cogs-brief dock-in dock-in-1">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 01 Brief</span>
            <h2 className="inv-panel__title">Food cost position</h2>
          </div>
          <span className="cogs-brief__stamp">
            {overTarget ? "over target" : kpis.targetCogsPct == null ? "no target" : "inside line"}
          </span>
        </div>

        {hasData ? (
          <>
            <div className="cogs-brief__hero">
              <span className={overTarget ? "cogs-brief__pct cogs-brief__pct--over" : "cogs-brief__pct"}>
                {kpis.cogsPct.toFixed(1)}
                <span>%</span>
              </span>
              <div className="cogs-brief__note">
                <span className="font-label">Current food cost</span>
                <p>
                  {kpis.targetCogsPct == null
                    ? "No target set. Leak ranking uses cost impact and item food-cost percent."
                    : `${formatDelta(kpis.deltaVsTargetPp)} vs ${formatPct(kpis.targetCogsPct)} target.`}
                </p>
              </div>
            </div>
            <dl className="cogs-brief__metrics">
              <div>
                <dt>COGS</dt>
                <dd>{formatMoney(kpis.cogsDollars)}</dd>
              </div>
              <div>
                <dt>Revenue</dt>
                <dd>{formatMoney(kpis.revenueDollars)}</dd>
              </div>
              <div>
                <dt>Prior</dt>
                <dd>{formatDelta(kpis.deltaVsPriorPp)}</dd>
              </div>
              <div>
                <dt>Data risk</dt>
                <dd>{dataQuality.warningCount}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="cogs-empty-note">
            No COGS data for this period. Sync invoices and Otter sales before
            reading the leak board.
          </div>
        )}
      </div>

      <div id="fix-first" className="inv-panel cogs-fixfirst dock-in dock-in-2">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 02 Fix first</span>
            <h2 className="inv-panel__title">Leak queue</h2>
          </div>
          {dataQuality.affectedRevenue > 0 ? (
            <span className="cogs-fixfirst__impact">
              {formatMoney(dataQuality.affectedRevenue)} sales at risk
            </span>
          ) : null}
        </div>

        {summary.actions.length > 0 ? (
          <ol className="cogs-action-list">
            {summary.actions.map((action, index) => (
              <li key={`${action.source}-${action.title}`}>
                <Link
                  href={action.href}
                  className={`cogs-action-row cogs-action-row--${action.severity}`}
                >
                  <span className="cogs-action-row__rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="cogs-action-row__body">
                    <span className="cogs-action-row__title">{action.title}</span>
                    <span className="cogs-action-row__meta">
                      {severityLabel(action.severity)} · {action.impactLabel}
                    </span>
                  </span>
                  <span className="cogs-action-row__cta">{action.actionLabel}</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="cogs-empty-note">
            No urgent leaks in this range. Review trend drift and ingredient
            drivers before changing menu prices.
          </div>
        )}
      </div>
    </section>
  )
}
