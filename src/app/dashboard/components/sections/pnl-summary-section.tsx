import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { PnLKpiStrip } from "@/components/pnl/pnl-kpi-strip"
import { fmtMoney, fmtPctFromRatio } from "@/lib/format"
import { getRangeStamp, type DashboardRange } from "@/lib/dashboard-utils"
import { cn } from "@/lib/utils"
import type { PnLSummaryPromise } from "./data"

/**
 * Owner-only "Profitability" block for the Overview page. Surfaces the existing
 * all-stores P&L (getAllStoresPnL) as a glance: a Net Profit headline plus a
 * four-card strip (Total Sales / COGS / Labor / Net Profit) and a link to the
 * full P&L. Reflects the dashboard's selected range, like the hero figures.
 */
export async function PnLSummarySection({
  pnlPromise,
  range,
}: {
  pnlPromise: PnLSummaryPromise
  range: DashboardRange
}) {
  const result = await pnlPromise
  const stamp = getRangeStamp(range)

  const header = (
    <div className="flex items-center gap-3 pb-3 mb-4 border-b border-(--hairline)">
      <span className="editorial-section-label">Profit &amp; loss · {stamp}</span>
      <div className="flex-1 h-px border-t border-dotted border-(--hairline-bold)" />
      <Link
        href="/dashboard/pnl"
        className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted) transition-colors hover:text-(--accent)"
      >
        View full P&amp;L
        <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
      </Link>
    </div>
  )

  if ("error" in result) {
    return (
      <div className="dock-in dock-in-3">
        {header}
        <section className="inv-panel inv-panel--alert">
          <p className="text-[13px]">
            P&amp;L is unavailable for this range. {result.error}
          </p>
        </section>
      </div>
    )
  }

  const c = result.combined
  const hasData = result.storeCount > 0 && c.grossSales > 0
  const profitNegative = c.bottomLine < 0

  return (
    <div className="dock-in dock-in-3">
      {header}

      {/* Net profit headline — the figure owners want first */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Net profit
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span
              className={cn(
                "font-(family-name:--font-dm-sans) text-[40px] leading-none font-semibold [font-variant-numeric:tabular-nums_lining-nums]",
                profitNegative ? "text-(--subtract)" : "text-(--ink)"
              )}
            >
              {hasData ? fmtMoney(c.bottomLine) : "—"}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--ink-muted) [font-variant-numeric:tabular-nums]">
              {hasData ? `${fmtPctFromRatio(c.marginPct)} margin` : "no data"}
            </span>
          </div>
        </div>
      </div>

      <PnLKpiStrip
        kpis={[
          { label: "Total sales", value: c.grossSales },
          {
            label: "COGS",
            value: c.cogsValue,
            percentOfSales: c.cogsPct,
            costStyle: true,
          },
          {
            label: "Labor",
            value: c.laborValue,
            percentOfSales: c.laborPct,
            costStyle: true,
          },
          {
            label: "Net profit",
            value: c.bottomLine,
            percentOfSales: c.marginPct,
          },
        ]}
      />
    </div>
  )
}
