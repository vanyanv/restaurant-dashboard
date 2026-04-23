"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLKpiStrip } from "./pnl-kpi-strip"
import { PnLStatement } from "./pnl-statement"
import { PnLWaterfall, type WaterfallStep } from "./pnl-waterfall"
import {
  TOTAL_SALES_CODE,
  UBER_COMMISSION_CODE,
  DOORDASH_COMMISSION_CODE,
  COGS_CODE,
  LABOR_CODE,
  RENT_CODE,
  CLEANING_CODE,
  TOWELS_CODE,
  AFTER_LABOR_RENT_CODE,
} from "@/lib/pnl"
import { getStorePnL, recomputeCogsForStore } from "@/app/actions/store-actions"

export interface PnLPageClientProps {
  storeId: string
  storeName: string
  allStores: Array<{ id: string; name: string }>
}

export function PnLPageClient({ storeId, storeName, allStores }: PnLPageClientProps) {
  const [state, setState] = useState<PnLRangeState>(defaultPnLRangeState)
  const queryClient = useQueryClient()

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

  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const result = await recomputeCogsForStore({ storeId, lookbackDays: 90 })
      if ("error" in result) throw new Error(result.error)
      return result
    },
    onSuccess: (result) => {
      toast.success(
        `Recomputed COGS: ${result.daysProcessed} day(s), ` +
          `${result.rowsUpserted} upserted, ${result.rowsDeleted} cleaned`
      )
      queryClient.invalidateQueries({ queryKey: ["pnl", storeId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to recompute COGS")
    },
  })

  const configureHref = `/dashboard/stores/${storeId}/edit`
  const data = query.data

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
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 text-xs">
            Labor and rent are not configured for this store.{" "}
            <Link href={configureHref} className="underline font-medium">
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
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {(query.error as Error).message}
          </div>
        ) : data && data.periods.length === 0 ? (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            No periods in the selected range.
          </div>
        ) : data ? (
          <>
            {(() => {
              if (data.periods.length === 0) return null
              // Show the full selected range — sum across all periods, not just
              // the latest one. Matches the KPI strip below and the Statement
              // totals on the right-most column.
              const sumRow = (code: string) => {
                const row = data.rows.find((r) => r.code === code)
                if (!row) return 0
                return row.values.reduce((a, b) => a + (b ?? 0), 0)
              }
              const gross = sumRow(TOTAL_SALES_CODE)
              // Commissions stored as negatives — convert to positive amounts here.
              const commissions = Math.abs(
                sumRow(UBER_COMMISSION_CODE) + sumRow(DOORDASH_COMMISSION_CODE)
              )
              const cogs = sumRow(COGS_CODE)
              const labor = sumRow(LABOR_CODE)
              const rent = sumRow(RENT_CODE)
              const cleaning = sumRow(CLEANING_CODE)
              const towels = sumRow(TOWELS_CODE)
              const bottom = sumRow(AFTER_LABOR_RENT_CODE)

              const steps: WaterfallStep[] = [
                { kind: "total", label: "Gross Sales", value: gross },
                { kind: "subtract", label: "3P Commissions", value: commissions },
                { kind: "subtract", label: "COGS", value: cogs },
                { kind: "subtract", label: "Labor", value: labor },
                { kind: "subtract", label: "Rent + Fixed", value: rent + cleaning + towels },
                { kind: "total", label: "Bottom Line", value: bottom },
              ]
              return <PnLWaterfall steps={steps} />
            })()}

            <PnLKpiStrip
              kpis={[
                { label: "Gross Sales", value: data.kpis.grossSales },
                {
                  label: "Net After Commissions",
                  value: data.kpis.netAfterCommissions,
                  percentOfSales:
                    data.kpis.grossSales === 0
                      ? 0
                      : data.kpis.netAfterCommissions / data.kpis.grossSales,
                },
                {
                  label: "Fixed Costs",
                  value: data.kpis.fixedCosts,
                  percentOfSales:
                    data.kpis.grossSales === 0
                      ? 0
                      : data.kpis.fixedCosts / data.kpis.grossSales,
                  costStyle: true,
                },
                {
                  label: "Bottom Line",
                  value: data.kpis.bottomLine,
                  percentOfSales: data.kpis.marginPct,
                },
              ]}
            />

            {data.cogs.refillFailedPeriodIndexes.length > 0 && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <strong>COGS not yet computed for {data.cogs.refillFailedPeriodIndexes.length} period{data.cogs.refillFailedPeriodIndexes.length === 1 ? "" : "s"}.</strong>{" "}
                    Sales exist but DailyCogsItem is empty — the scheduled
                    refresh hasn&apos;t caught up since the last data change.
                    Click Recompute to fill now, or wait up to 15 min for the
                    next sweep.
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-red-400 bg-white text-xs text-red-900 hover:bg-red-100"
                    onClick={() => recomputeMutation.mutate()}
                    disabled={recomputeMutation.isPending}
                  >
                    {recomputeMutation.isPending ? "Recomputing…" : "Recompute now"}
                  </Button>
                </div>
              </div>
            )}

            {data.cogs.unmappedItems.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <strong>COGS is undercounted.</strong>{" "}
                    {data.cogs.unmappedItems.length} sold item
                    {data.cogs.unmappedItems.length === 1 ? "" : "s"} ($
                    {data.cogs.unmappedItems
                      .reduce((a, b) => a + b.salesRevenue, 0)
                      .toFixed(0)}{" "}
                    of sales) aren&apos;t mapped to a recipe yet.
                  </div>
                  <a
                    href="/dashboard/recipes"
                    className="shrink-0 underline hover:text-amber-700"
                  >
                    Build recipes →
                  </a>
                </div>
              </div>
            )}

            {data.cogs.missingCostItems.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <strong>COGS may be undercounted.</strong>{" "}
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
                    className="shrink-0 underline hover:text-amber-700"
                  >
                    Fix ingredients →
                  </a>
                </div>
              </div>
            )}

            <PnLStatement
              rows={data.rows}
              periods={data.periods}
              title="The Statement"
            />

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
                onClick={() => recomputeMutation.mutate()}
                disabled={recomputeMutation.isPending}
              >
                <RefreshCw
                  className={`mr-1 h-3 w-3 ${recomputeMutation.isPending ? "animate-spin" : ""}`}
                />
                {recomputeMutation.isPending ? "Recomputing…" : "Recompute COGS"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
