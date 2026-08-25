"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { addDays, differenceInCalendarDays, format } from "date-fns"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { EditorialTopbar } from "@/app/dashboard/(editorial)/components/editorial-topbar"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLKpiStrip } from "./pnl-kpi-strip"
import { PnLStatement } from "./pnl-statement"
import { PnLWaterfall } from "./pnl-waterfall"
import { buildWaterfallSteps } from "./waterfall-steps"
import type { Period, PnLRow } from "@/lib/pnl"
import { getStorePnL } from "@/app/actions/store-actions"

export interface PnLPageClientProps {
  storeId: string
  storeName: string
  allStores: Array<{ id: string; name: string }>
}

/** Serialize the statement exactly as displayed: accounts down, periods
 *  across, plus a range-total column. Raw numbers, no formatting — this is
 *  for the accountant's spreadsheet, not for reading. */
function exportStatementCsv(storeName: string, periods: Period[], rows: PnLRow[]) {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
  const header = ["Account", ...periods.map((p) => p.label), "Total"]
  const lines = [header.map(quote).join(",")]
  for (const row of rows) {
    const total = row.values.reduce((a, b) => a + (b ?? 0), 0)
    lines.push(
      [
        quote(row.label),
        ...row.values.map((v) => (v == null ? "" : v.toFixed(2))),
        total.toFixed(2),
      ].join(",")
    )
  }
  const start = periods[0]?.startDate.toISOString().slice(0, 10) ?? "start"
  const end = periods[periods.length - 1]?.endDate.toISOString().slice(0, 10) ?? "end"
  const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `pnl-${slug}-${start}-${end}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function PnLPageClient({ storeId, storeName, allStores }: PnLPageClientProps) {
  const [state, setState] = useState<PnLRangeState>(defaultPnLRangeState)

  const query = useQuery({
    queryKey: [
      "pnl",
      storeId,
      state.startDate.toISOString(),
      state.endDate.toISOString(),
      state.granularity,
    ],
    queryFn: async () => {
      const result = await getStorePnL({
        storeId,
        startDate: state.startDate,
        endDate: state.endDate,
        granularity: state.granularity,
      })
      if ("error" in result) throw new Error(result.error)
      return result
    },
  })

  // Previous equal-length window — feeds the waterfall and KPI Δ stamps.
  const rangeDays = differenceInCalendarDays(state.endDate, state.startDate) + 1
  const priorEnd = addDays(state.startDate, -1)
  const priorStart = addDays(priorEnd, -(rangeDays - 1))
  const priorQuery = useQuery({
    queryKey: [
      "pnl",
      storeId,
      priorStart.toISOString(),
      priorEnd.toISOString(),
      state.granularity,
    ],
    queryFn: async () => {
      const result = await getStorePnL({
        storeId,
        startDate: priorStart,
        endDate: priorEnd,
        granularity: state.granularity,
      })
      if ("error" in result) throw new Error(result.error)
      return result
    },
  })

  const configureHref = `/dashboard/stores/${storeId}/edit`
  const data = query.data
  // A prior window with no trade would render every Δ as a giant gain —
  // suppress the stamps until the comparison means something.
  const prior = priorQuery.data
  const priorHasTrade = (prior?.kpis.grossSales ?? 0) > 0
  const priorNote = `Δ vs ${format(priorStart, "MMM d")} – ${format(priorEnd, "MMM d")}`

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 11"
        title={`P&L · ${storeName}`}
      />

      <div className="flex flex-1 flex-col gap-4 p-4">
        <PnLHeader
          title={`P&L — ${storeName}`}
          state={state}
          onChange={setState}
          isPending={query.isFetching}
          stores={allStores}
          currentStoreId={storeId}
        />

        {data && !data.fixedLaborConfigured && !data.fixedRentConfigured && (
          <div className="rounded-xs border border-(--hairline-bold) bg-(--paper-warm) p-3 text-xs text-(--ink-muted)">
            Labor and rent are not configured for this store.{" "}
            <Link href={configureHref} className="underline font-medium text-(--accent-dark)">
              Set fixed costs →
            </Link>
          </div>
        )}

        {query.isLoading ? (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
            <Skeleton className="h-95" />
          </>
        ) : query.error ? (
          <div className="rounded-xs border border-(--hairline-bold) bg-(--accent-bg) p-4 text-sm text-(--accent-dark)">
            {(query.error as Error).message}
          </div>
        ) : data && data.periods.length === 0 ? (
          <div className="rounded-xs border border-(--hairline-bold) bg-(--paper) p-4 text-sm text-(--ink-muted)">
            No periods in the selected range.
          </div>
        ) : data ? (
          <>
            {(() => {
              if (data.periods.length === 0) return null
              // Show the full selected range — sum across all periods, not just
              // the latest one. Matches the KPI strip below and the Statement
              // totals on the right-most column.
              const steps = buildWaterfallSteps(data.rows)
              const priorSteps =
                priorHasTrade && prior ? buildWaterfallSteps(prior.rows) : undefined
              return (
                <PnLWaterfall
                  steps={steps}
                  priorSteps={priorSteps}
                  priorNote={priorSteps ? priorNote : undefined}
                />
              )
            })()}

            <PnLKpiStrip
              kpis={[
                {
                  label: "Gross Sales",
                  value: data.kpis.grossSales,
                  prior: priorHasTrade ? prior?.kpis.grossSales : null,
                },
                {
                  label: "Net After Commissions",
                  value: data.kpis.netAfterCommissions,
                  percentOfSales:
                    data.kpis.grossSales === 0
                      ? 0
                      : data.kpis.netAfterCommissions / data.kpis.grossSales,
                  prior: priorHasTrade ? prior?.kpis.netAfterCommissions : null,
                },
                {
                  label: "Fixed Costs",
                  value: data.kpis.fixedCosts,
                  percentOfSales:
                    data.kpis.grossSales === 0
                      ? 0
                      : data.kpis.fixedCosts / data.kpis.grossSales,
                  costStyle: true,
                  prior: priorHasTrade ? prior?.kpis.fixedCosts : null,
                },
                {
                  label: "Bottom Line",
                  value: data.kpis.bottomLine,
                  percentOfSales: data.kpis.marginPct,
                  prior: priorHasTrade ? prior?.kpis.bottomLine : null,
                },
              ]}
            />

            {data.cogs.refillFailedPeriodIndexes.length > 0 && (
              <div className="rounded-xs border border-(--hairline-bold) bg-(--accent-bg) px-4 py-3 text-sm text-(--accent-dark)">
                <strong>COGS not yet computed for {data.cogs.refillFailedPeriodIndexes.length} period{data.cogs.refillFailedPeriodIndexes.length === 1 ? "" : "s"}.</strong>{" "}
                Sales exist but the cost rows haven&apos;t landed — the
                scheduled refresh fills this automatically within ~15 minutes
                of a data change. Margins for those periods read high until
                then.
              </div>
            )}

            {data.cogs.unmappedItems.length > 0 && (
              <div className="rounded-xs border border-(--hairline-bold) bg-(--paper-warm) px-4 py-3 text-sm text-(--ink-muted)">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <strong className="text-(--ink)">COGS is undercounted.</strong>{" "}
                    {data.cogs.unmappedItems.length} sold item
                    {data.cogs.unmappedItems.length === 1 ? "" : "s"} ($
                    {data.cogs.unmappedItems
                      .reduce((a, b) => a + b.salesRevenue, 0)
                      .toFixed(0)}{" "}
                    of sales) aren&apos;t mapped to a recipe yet.
                  </div>
                  <a
                    href="/dashboard/recipes?filter=unbuilt"
                    className="shrink-0 underline hover:text-(--accent-dark)"
                  >
                    Review {data.cogs.unmappedItems.length} item
                    {data.cogs.unmappedItems.length === 1 ? "" : "s"} →
                  </a>
                </div>
              </div>
            )}

            {data.cogs.missingCostItems.length > 0 && (
              <div className="rounded-xs border border-(--hairline-bold) bg-(--paper-warm) px-4 py-3 text-sm text-(--ink-muted)">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <strong className="text-(--ink)">COGS may be undercounted.</strong>{" "}
                    {data.cogs.missingCostItems.length} mapped item
                    {data.cogs.missingCostItems.length === 1 ? "" : "s"} ($
                    {data.cogs.missingCostItems
                      .reduce((a, b) => a + b.salesRevenue, 0)
                      .toFixed(0)}{" "}
                    of sales) have no costable ingredients — missing canonical
                    cost or unit-conversion failure.
                  </div>
                  <a
                    href="/dashboard/ingredients"
                    className="shrink-0 underline hover:text-(--accent-dark)"
                  >
                    Fix {data.cogs.missingCostItems.length} ingredient
                    {data.cogs.missingCostItems.length === 1 ? "" : "s"} →
                  </a>
                </div>
              </div>
            )}

            <PnLStatement
              rows={data.rows}
              periods={data.periods}
              title="The Statement"
              actions={
                <div className="flex items-center gap-2">
                  <Link href={`/dashboard/analytics/${storeId}`}>
                    <Button variant="outline" size="sm" className="h-8 text-xs">
                      View analytics
                    </Button>
                  </Link>
                  <Link href={configureHref}>
                    <Button variant="outline" size="sm" className="h-8 text-xs">
                      Edit fixed costs
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => exportStatementCsv(storeName, data.periods, data.rows)}
                  >
                    Export CSV
                  </Button>
                </div>
              }
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
