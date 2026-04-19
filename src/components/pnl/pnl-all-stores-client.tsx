"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { StoreComparisonChart } from "@/components/charts/store-comparison-chart"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLKpiStrip } from "./pnl-kpi-strip"
import { PnLStoreCard } from "./pnl-store-card"
import { getAllStoresPnL } from "@/app/actions/store-actions"

export interface PnLAllStoresClientProps {
  stores: Array<{ id: string; name: string }>
}

export function PnLAllStoresClient({ stores }: PnLAllStoresClientProps) {
  const [state, setState] = useState<PnLRangeState>(defaultPnLRangeState)

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

  const combined = query.data?.combined
  const perStore = query.data?.perStore ?? []

  return (
    <div>
      <header className="flex h-16 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>P&amp;L — All Stores</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
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
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-[320px]" />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          </>
        ) : query.error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {(query.error as Error).message}
          </div>
        ) : combined ? (
          <>
            <PnLKpiStrip
              kpis={[
                {
                  label: "Gross Sales",
                  value: combined.grossSales,
                },
                {
                  label: "Net After Commissions",
                  value: combined.netAfterCommissions,
                  percentOfSales:
                    combined.grossSales === 0
                      ? 0
                      : combined.netAfterCommissions / combined.grossSales,
                },
                {
                  label: "Labor + Rent",
                  value: combined.laborPlusRent,
                  percentOfSales:
                    combined.grossSales === 0
                      ? 0
                      : combined.laborPlusRent / combined.grossSales,
                  costStyle: true,
                },
                {
                  label: "Bottom Line",
                  value: combined.bottomLine,
                  percentOfSales: combined.marginPct,
                },
              ]}
            />

            {perStore.length > 1 && (
              <StoreComparisonChart
                data={perStore.map((s) => ({
                  storeName: s.storeName,
                  grossSales: Math.round(s.grossSales),
                  netSales: Math.round(s.bottomLine),
                }))}
                title="Store Comparison"
                description="Gross Sales vs Bottom Line by location"
              />
            )}

            {perStore.length === 0 ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No stores yet. Create one from{" "}
                <a href="/dashboard/stores" className="underline">
                  Store Management
                </a>
                .
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {perStore.map((s) => (
                  <PnLStoreCard
                    key={s.storeId}
                    storeId={s.storeId}
                    storeName={s.storeName}
                    grossSales={s.grossSales}
                    bottomLine={s.bottomLine}
                    marginPct={s.marginPct}
                    channelMix={s.channelMix}
                    fixedCostsConfigured={s.fixedCostsConfigured}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
