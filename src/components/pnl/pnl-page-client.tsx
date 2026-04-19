"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLKpiStrip } from "./pnl-kpi-strip"
import { PnLChannelDonut } from "./pnl-channel-donut"
import { PnLTrendChart } from "./pnl-trend-chart"
import { PnLSummaryTable } from "./pnl-summary-table"
import { PnLTable } from "./pnl-table"
import { getStorePnL, recomputeCogsForStore } from "@/app/actions/store-actions"

export interface PnLPageClientProps {
  storeId: string
  storeName: string
  allStores: Array<{ id: string; name: string }>
}

export function PnLPageClient({ storeId, storeName, allStores }: PnLPageClientProps) {
  const [state, setState] = useState<PnLRangeState>(defaultPnLRangeState)
  const [detailOpen, setDetailOpen] = useState(false)
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
        `Recomputed COGS: ${result.daysProcessed} day(s), ${result.rowsWritten} row(s)`
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
              <Skeleton className="h-[320px]" />
              <Skeleton className="h-[320px]" />
            </div>
            <Skeleton className="h-[380px]" />
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

            <div className="grid gap-4 md:grid-cols-2">
              <PnLChannelDonut data={data.channelMix} />
              <PnLTrendChart
                periods={data.periods}
                totalSales={data.trend.totalSales}
                bottomLine={data.trend.bottomLine}
              />
            </div>

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

            <PnLSummaryTable rows={data.rows} configureHref={configureHref} />

            <div className="rounded-lg border bg-card">
              <button
                type="button"
                onClick={() => setDetailOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                <span>Show full line-item detail (GL accounts)</span>
                {detailOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {detailOpen && (
                <div className="border-t p-3">
                  <PnLTable
                    periods={data.periods}
                    rows={data.rows}
                    configureHref={configureHref}
                  />
                </div>
              )}
            </div>

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
