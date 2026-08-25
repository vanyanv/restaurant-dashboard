import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { fmtMoney, fmtPctFromRatio } from "@/lib/format"
import { getRangeStamp, type DashboardRange } from "@/lib/dashboard-utils"
import { cn } from "@/lib/utils"
import {
  computePnLPace,
  formatMarginPace,
  formatProfitPace,
  sumPnLDays,
} from "@/lib/pnl-pace"
import { rangeDateLabel } from "@/lib/dashboard/range-label"
import type { PnLBaseline, PnLSummaryPromise } from "./data"

/**
 * Owner-only "Profitability" block for the Overview page. Surfaces the existing
 * all-stores P&L (getAllStoresPnL) as a glance: a Net Profit headline plus a
 * four-card strip (Total Sales / COGS / Labor / Net Profit) and a link to the
 * full P&L. Reflects the dashboard's selected range, like the hero figures —
 * including the "vs avg" pace line, which is computed against the same
 * weekday-aligned four-week baseline the hero strip uses.
 */
export async function PnLSummarySection({
  pnlPromise,
  baseline,
  range,
}: {
  pnlPromise: PnLSummaryPromise
  baseline: PnLBaseline | null
  range: DashboardRange
}) {
  const [result, baselineResult] = await Promise.all([
    pnlPromise,
    baseline?.promise ?? Promise.resolve(null),
  ])
  const stamp = getRangeStamp(range)
  const isToday = range.kind === "days" && range.days === 1

  const header = (
    <div className="flex items-center gap-3 pb-3 mb-4 border-b border-(--hairline)">
      <span className="editorial-section-label">
        Profit &amp; loss · {rangeDateLabel(range)}
        {isToday ? " · day in progress" : ""}
      </span>
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

  // Everything between the prime cost and the bottom line: platform
  // commissions plus occupancy and the other fixed lines.
  //
  // Taken as the RESIDUAL rather than as (gross - netAfterCommissions) +
  // fixedCosts. That sum double-counted — it rendered 55.2% of sales against a
  // column set that then totalled 122%, because the two source fields overlap.
  // The residual is the only formula that guarantees the five columns subtract
  // to the bottom line the sixth one states.
  const feesAndFixed =
    c.grossSales - c.cogsValue - c.laborValue - c.bottomLine
  const feesAndFixedPct = c.grossSales > 0 ? feesAndFixed / c.grossSales : 0
  const primeCost = c.cogsValue + c.laborValue
  const primePct = c.grossSales > 0 ? primeCost / c.grossSales : 0

  // A day in progress collects sales continuously but labor in lumps: Harri
  // posts through the day and fixed costs are apportioned at close. Early in
  // service that leaves a real sales number divided by a near-zero cost base,
  // which renders as an exceptional margin — the audit caught 35.8% off labor
  // of $19 (0.9% of sales) against a trailing 17.8%. No restaurant runs a
  // single-digit labor percentage, so treat that as "not in yet" and withhold
  // every ratio derived from it rather than publishing a flattering fiction.
  const MIN_PLAUSIBLE_LABOR_PCT = 0.05
  // Not gated on `isToday` any more. A single-digit labor percentage means the
  // hours are not in, and that is just as true of a day in January that never
  // had labor synced as of a day still in service — the January view published
  // a 67.4% margin off $0.00 of labor. Only the EXPLANATION differs by range;
  // the withholding does not.
  const laborIncomplete = hasData && c.laborPct < MIN_PLAUSIBLE_LABOR_PCT
  const marginTrustworthy = hasData && !laborIncomplete

  // Profit pace, on the same baseline as the hero strip: this range against
  // the average of the same dates one to four weeks back.
  //
  // Withheld while the range is still running. Sales accrue by the minute but
  // COGS and labor post in lumps, so a partial day's profit against four
  // settled days is not a slow day — it is an unfinished one. The hourly pace
  // above can slice its baseline to the current hour; a P&L cannot.
  const pace =
    baseline && baselineResult && !("error" in baselineResult) && marginTrustworthy
      ? computePnLPace(
          { totalSales: c.grossSales, bottomLine: c.bottomLine },
          baseline.comparisonGroups.map((group) =>
            sumPnLDays(baselineResult.consolidatedRows, baseline.periodDates, group)
          )
        )
      : null
  const profitPace = baseline?.inProgress
    ? null
    : formatProfitPace(pace, baseline?.label ?? "")
  const marginPace = baseline?.inProgress
    ? null
    : formatMarginPace(pace, baseline?.label ?? "")

  return (
    <div className="dock-in dock-in-3">
      {header}

      {/* Net profit headline — the figure owners want first */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            Net profit
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={cn(
                "whitespace-nowrap font-(family-name:--font-dm-sans) text-[44px] leading-none font-semibold [font-variant-numeric:tabular-nums_lining-nums]",
                profitNegative ? "text-(--subtract)" : "text-(--ink)"
              )}
            >
              {hasData ? fmtMoney(c.bottomLine) : "—"}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--ink-muted) [font-variant-numeric:tabular-nums]">
              {marginTrustworthy
                ? `${fmtPctFromRatio(c.marginPct)} margin`
                : hasData
                  ? "margin pending"
                  : "no data"}
            </span>
            {laborIncomplete ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--ink-muted)">
                {isToday
                  ? "labor still posting — margin follows at close"
                  : "no labor posted for this range — margin withheld"}
              </span>
            ) : isToday && hasData && profitNegative ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--ink-faint)">
                costs post in lumps — judge after close
              </span>
            ) : null}
          </div>
          {(profitPace || marginPace) && (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {profitPace && (
                <span
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.14em] [font-variant-numeric:tabular-nums]",
                    (pace?.profitPct ?? 0) > 0
                      ? "text-(--accent)"
                      : (pace?.profitPct ?? 0) < 0
                        ? "text-(--subtract)"
                        : "text-(--ink-muted)"
                  )}
                >
                  {profitPace}
                </span>
              )}
              {marginPace && (
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--ink-muted) [font-variant-numeric:tabular-nums]">
                  {marginPace}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Five columns, not four. The overview used to show Sales, COGS, Labor
          and Net profit — a subtraction that visibly did not add up, because
          commissions and fixed costs were missing from the middle of it.
          `netAfterCommissions` and `fixedCosts` are both on `combined`, so the
          gap closes exactly rather than by derivation. */}
      <div className="pnl-rail">
        <div className="pnl-rail__cell">
          {/* "(ex-tax)" reconciles this figure against the masthead rail's Net
              sales — they differ by exactly the collected tax, which the
              overview audit flagged as an unexplained third "sales" number. */}
          <div className="pnl-rail__label">Sales (ex-tax)</div>
          <div className="pnl-rail__value">{fmtMoney(c.grossSales)}</div>
          <div className="pnl-rail__sub">100.0%</div>
        </div>
        <div className="pnl-rail__cell">
          <div className="pnl-rail__label">COGS</div>
          <div className="pnl-rail__value is-cost">{fmtMoney(c.cogsValue)}</div>
          <div className="pnl-rail__sub">
            {hasData ? `${fmtPctFromRatio(c.cogsPct)} of sales` : "—"}
          </div>
        </div>
        <div className="pnl-rail__cell">
          <div className="pnl-rail__label">Labor</div>
          <div className="pnl-rail__value is-cost">{fmtMoney(c.laborValue)}</div>
          <div className={cn("pnl-rail__sub", laborIncomplete && "is-breach")}>
            {laborIncomplete
              ? isToday
                ? "so far today"
                : "not posted"
              : hasData
                ? `${fmtPctFromRatio(c.laborPct)} of sales`
                : "—"}
          </div>
        </div>
        <div className="pnl-rail__cell">
          <div className="pnl-rail__label">Fees &amp; fixed</div>
          <div className="pnl-rail__value is-cost">{fmtMoney(feesAndFixed)}</div>
          <div className="pnl-rail__sub">
            {hasData ? `${fmtPctFromRatio(feesAndFixedPct)} of sales` : "—"}
          </div>
        </div>
        <div className="pnl-rail__cell">
          <div className="pnl-rail__label">Net profit</div>
          <div
            className={cn("pnl-rail__value", profitNegative && "is-cost")}
          >
            {fmtMoney(c.bottomLine)}
          </div>
          <div className="pnl-rail__sub">
            {marginTrustworthy
              ? `${fmtPctFromRatio(c.marginPct)} margin`
              : laborIncomplete
                ? "before full labor"
                : "—"}
          </div>
        </div>
      </div>

      {hasData && (
        <div className="pnl-prime">
          Prime cost {fmtMoney(primeCost)}
          {marginTrustworthy ? ` · ${fmtPctFromRatio(primePct)} of sales` : ""} ·
          target 55% or under
        </div>
      )}
    </div>
  )
}
