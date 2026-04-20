"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLLede } from "./pnl-lede"
import { PnLWaterfall, type WaterfallStep } from "./pnl-waterfall"
import { PnLLeagueTable } from "./pnl-league-table"
import { getAllStoresPnL } from "@/app/actions/store-actions"
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

export interface PnLAllStoresClientProps {
  stores: Array<{ id: string; name: string }>
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

  const data = query.data

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
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {(query.error as Error).message}
          </div>
        ) : data ? (
          <>
            {/* Lede — use the consolidated bottom-line series */}
            <PnLLede
              storeName={stores.length === 1 ? stores[0].name : "The business"}
              bottomLineByPeriod={
                data.consolidatedRows.find((r) => r.code === AFTER_LABOR_RENT_CODE)?.values ?? []
              }
              grossByPeriod={
                data.consolidatedRows.find((r) => r.code === TOTAL_SALES_CODE)?.values ?? []
              }
              periods={data.periods}
            />

            {/* Combined waterfall for the latest period */}
            {data.periods.length > 0 && data.consolidatedRows.length > 0 ? (
              (() => {
                const latestIdx = data.periods.length - 1
                const latest = (code: string) =>
                  data.consolidatedRows.find((r) => r.code === code)?.values[latestIdx] ?? 0
                const gross = latest(TOTAL_SALES_CODE)
                const commissions = Math.abs(
                  latest(UBER_COMMISSION_CODE) + latest(DOORDASH_COMMISSION_CODE)
                )
                const cogs = latest(COGS_CODE)
                const labor = latest(LABOR_CODE)
                const rent = latest(RENT_CODE)
                const cleaning = latest(CLEANING_CODE)
                const towels = latest(TOWELS_CODE)
                const bottom = latest(AFTER_LABOR_RENT_CODE)

                const steps: WaterfallStep[] = [
                  { kind: "total", label: "Gross Sales", value: gross },
                  { kind: "subtract", label: "3P Commissions", value: commissions },
                  { kind: "subtract", label: "COGS", value: cogs },
                  { kind: "subtract", label: "Labor", value: labor },
                  { kind: "subtract", label: "Rent + Fixed", value: rent + cleaning + towels },
                  { kind: "total", label: "Bottom Line", value: bottom },
                ]
                return <PnLWaterfall steps={steps} />
              })()
            ) : null}

            {/* League table — compare across stores for the latest period */}
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
              />
            ) : (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No stores yet. Create one from{" "}
                <a href="/dashboard/stores" className="underline">
                  Store Management
                </a>
                .
              </div>
            )}

          </>
        ) : null}
      </div>
    </div>
  )
}
