"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { addDays, differenceInCalendarDays, format } from "date-fns"
import { Skeleton } from "@/components/ui/skeleton"
import { EditorialTopbar } from "@/app/dashboard/(editorial)/components/editorial-topbar"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLWaterfall } from "./pnl-waterfall"
import { PnLPeriodStrip } from "./pnl-period-strip"
import { PnLLeagueTable } from "./pnl-league-table"
import { PnLStoreComparison } from "./pnl-store-comparison"
import { buildWaterfallSteps } from "./waterfall-steps"
import { TOTAL_SALES_CODE, AFTER_LABOR_RENT_CODE } from "@/lib/pnl"
import { getAllStoresPnL } from "@/app/actions/store-actions"

export interface PnLAllStoresClientProps {
  stores: Array<{ id: string; name: string; lifecycleStage?: string }>
  initialState?: PnLRangeState
}

export function PnLAllStoresClient({ stores, initialState }: PnLAllStoresClientProps) {
  const [state, setState] = useState<PnLRangeState>(
    () => initialState ?? defaultPnLRangeState(),
  )

  const query = useQuery({
    queryKey: [
      "pnl-all",
      state.startDate.toISOString(),
      state.endDate.toISOString(),
      state.granularity,
    ],
    queryFn: async () => {
      const result = await getAllStoresPnL({
        startDate: state.startDate,
        endDate: state.endDate,
        granularity: state.granularity,
      })
      if ("error" in result) throw new Error(result.error)
      return result
    },
  })

  // Previous equal-length window, for the waterfall's Δ stamps.
  const rangeDays = differenceInCalendarDays(state.endDate, state.startDate) + 1
  const priorEnd = addDays(state.startDate, -1)
  const priorStart = addDays(priorEnd, -(rangeDays - 1))
  const priorQuery = useQuery({
    queryKey: [
      "pnl-all",
      priorStart.toISOString(),
      priorEnd.toISOString(),
      state.granularity,
    ],
    queryFn: async () => {
      const result = await getAllStoresPnL({
        startDate: priorStart,
        endDate: priorEnd,
        granularity: state.granularity,
      })
      if ("error" in result) throw new Error(result.error)
      return result
    },
  })

  const data = query.data
  const preOpenStoreIds = stores
    .filter((s) => s.lifecycleStage === "pre_open")
    .map((s) => s.id)
  const preOpenSet = new Set(preOpenStoreIds)

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 11"
        title="P&L · All Stores"
        stamps={
          <span>
            {stores.length} store{stores.length !== 1 ? "s" : ""}
          </span>
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-4">
        <PnLHeader
          title="P&L — All Stores"
          state={state}
          onChange={setState}
          isPending={query.isFetching}
          stores={stores}
          currentStoreId={undefined}
        />

        {query.isLoading ? (
          <>
            <Skeleton className="h-48" />
            <Skeleton className="h-70" />
            <Skeleton className="h-65" />
            <Skeleton className="h-105" />
          </>
        ) : query.error ? (
          <div className="inv-panel inv-panel--alert p-4 text-sm">
            {(query.error as Error).message}
          </div>
        ) : data ? (
          <>
            {/* Combined waterfall for the full selected range */}
            {data.periods.length > 0 && data.consolidatedRows.length > 0 ? (
              (() => {
                const steps = buildWaterfallSteps(data.consolidatedRows)
                const priorRows = priorQuery.data?.consolidatedRows
                const priorSteps =
                  priorRows && priorRows.length > 0 ? buildWaterfallSteps(priorRows) : undefined
                // A prior window with no trade (pre-launch) would render every
                // Δ as a giant gain — suppress until there is something real.
                const priorHasTrade = priorSteps?.[0] != null && priorSteps[0].value > 0
                return (
                  <PnLWaterfall
                    steps={steps}
                    priorSteps={priorHasTrade ? priorSteps : undefined}
                    priorNote={
                      priorHasTrade
                        ? `Δ vs ${format(priorStart, "MMM d")} – ${format(priorEnd, "MMM d")}`
                        : undefined
                    }
                  />
                )
              })()
            ) : null}

            {/* Per-period read — the section the granularity control drives */}
            {data.periods.length > 1 ? (
              (() => {
                const salesRow = data.consolidatedRows.find((r) => r.code === TOTAL_SALES_CODE)
                const bottomRow = data.consolidatedRows.find(
                  (r) => r.code === AFTER_LABOR_RENT_CODE
                )
                if (!salesRow || !bottomRow) return null
                return (
                  <PnLPeriodStrip
                    periods={data.periods}
                    sales={salesRow.values}
                    bottomLine={bottomRow.values}
                  />
                )
              })()
            ) : null}

            {/* League table — compare across stores for the selected range */}
            {data.perStore.length > 0 ? (
              <PnLLeagueTable
                rows={data.perStore.map((s) => ({
                  storeId: s.storeId,
                  storeName: s.storeName,
                  grossSales: s.grossSales,
                  cogsPct: s.cogsPct,
                  laborPct: s.laborPct,
                  rentPct: s.rentPct,
                  bottomLine: s.bottomLine,
                  marginPct: s.marginPct,
                  fixedCostsConfigured: s.fixedCostsConfigured,
                }))}
                preOpenStoreIds={preOpenStoreIds}
              />
            ) : (
              <div className="inv-panel inv-panel--empty p-6 text-sm">
                No stores yet. Create one from{" "}
                <a href="/dashboard/stores" className="underline">
                  Store Management
                </a>
                .
              </div>
            )}

            {/* Stores side by side — earns its place once 2+ stores trade.
                With a single operational store it repeats the waterfall and
                league verbatim, so it stays collapsed until then. */}
            {(() => {
              const trading = data.perStore.filter(
                (s) => !preOpenSet.has(s.storeId) && s.grossSales > 0
              )
              if (trading.length < 2) return null
              return (
                <PnLStoreComparison
                  stores={trading.map((s) => ({
                    storeId: s.storeId,
                    storeName: s.storeName,
                    grossSales: s.grossSales,
                    cogsValue: s.cogsValue,
                    laborValue: s.laborValue,
                    rentValue:
                      s.rentValue + (s.fixedCosts - s.laborValue - s.rentValue),
                    bottomLine: s.bottomLine,
                    marginPct: s.marginPct,
                    fixedCostsConfigured: s.fixedCostsConfigured,
                  }))}
                  total={{
                    storeId: null,
                    storeName: "Total",
                    grossSales: data.combined.grossSales,
                    cogsValue: data.combined.cogsValue,
                    laborValue: data.combined.laborValue,
                    rentValue:
                      data.combined.rentValue +
                      (data.combined.fixedCosts -
                        data.combined.laborValue -
                        data.combined.rentValue),
                    bottomLine: data.combined.bottomLine,
                    marginPct: data.combined.marginPct,
                    fixedCostsConfigured: true,
                  }}
                />
              )
            })()}

          </>
        ) : null}
      </div>
    </div>
  )
}
