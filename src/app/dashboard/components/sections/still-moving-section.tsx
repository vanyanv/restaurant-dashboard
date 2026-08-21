import type { CSSProperties } from "react"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { localDateStr, type DashboardRange } from "@/lib/dashboard-utils"
import { formatMoneyLarge } from "../hero-kpi"
import { fetchInvoiceSummary, type OtterPromise, type PnLSummaryPromise } from "./data"

interface Cell {
  value: string
  unit: string
  note: string
  flagged?: boolean
}

/**
 * "Still moving" — everything that will change the masthead's figures before
 * the day closes.
 *
 * Every cell here is derived from something the database actually holds. Two
 * things the design called for are deliberately absent: open ticket counts and
 * the next payout. Otter only syncs completed orders, so "open tickets" has no
 * source; `OtterOrder` carries no payout or payoutDate column, so a payout
 * figure would have to be invented. A band that reports pending state is worth
 * nothing if any of it is made up.
 */
export async function StillMovingSection({
  range,
  otterPromise,
  pnlPromise,
}: {
  range: DashboardRange
  otterPromise: OtterPromise
  pnlPromise: PnLSummaryPromise | null
}) {
  const isToday = range.kind === "days" && range.days === 1

  const [otter, invoices, pnl, forecast] = await Promise.all([
    otterPromise,
    fetchInvoiceSummary(),
    pnlPromise ?? Promise.resolve(null),
    isToday
      ? getRevenueForecast({ horizonDays: 1 }).catch(() => null)
      : Promise.resolve(null),
  ])

  const cells: Cell[] = []

  // 1 — what the model still expects today, less what has landed.
  if (isToday && forecast?.ok) {
    const today = localDateStr(new Date())
    const day =
      forecast.data.days.find((d) => localDateStr(d.date) === today) ?? null
    const gross = otter?.kpis.grossRevenue ?? null
    if (day && gross != null) {
      const remaining = day.predictedRevenue - gross
      cells.push(
        remaining > 0
          ? {
              value: formatMoneyLarge(remaining),
              unit: "left to land",
              note: `Against a ${formatMoneyLarge(day.predictedRevenue)} forecast`,
            }
          : {
              value: formatMoneyLarge(Math.abs(remaining)),
              unit: "past forecast",
              note: `Already over the ${formatMoneyLarge(day.predictedRevenue)} call`,
            }
      )
    }
  }

  // 2 — invoices that have not reached COGS yet.
  if (invoices && invoices.pendingReviewCount > 0) {
    cells.push({
      value: formatMoneyLarge(invoices.pendingReviewTotal),
      unit: "unposted",
      note: `${invoices.pendingReviewCount} invoice${
        invoices.pendingReviewCount === 1 ? "" : "s"
      } · COGS understated`,
      flagged: true,
    })
  }

  // 3 — labor posts in lumps, so say whether today's share can be trusted yet.
  const combined =
    pnl != null && !("error" in pnl) && pnl.storeCount > 0 ? pnl.combined : null
  if (combined) {
    const settled = combined.laborPct >= 0.05
    cells.push({
      value: settled ? formatMoneyLarge(combined.laborValue) : "—",
      unit: settled ? "labor posted" : "labor posting",
      note: settled
        ? "Settled for this range"
        : "Too little in to judge the share",
      flagged: !settled && isToday,
    })
  }

  if (cells.length === 0) return null

  return (
    <div className="dock-in dock-in-4">
      <div className="mb-0 flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] pb-3">
        <span className="editorial-section-label">Still moving</span>
        <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-faint)">
          What will change the figures above
        </span>
      </div>
      <div
        className="moving-band"
        style={{ "--moving-cells": cells.length } as CSSProperties}
      >
        {cells.map((c) => (
          <div key={`${c.unit}-${c.value}`} className="moving-band__cell">
            <div className="moving-band__value">
              {c.value} <span className="moving-band__unit">{c.unit}</span>
            </div>
            <div
              className={`moving-band__note${c.flagged ? " is-flagged" : ""}`}
            >
              {c.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
