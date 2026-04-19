"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { PnLHeader } from "./pnl-header"
import { defaultPnLRangeState, type PnLRangeState } from "./pnl-date-controls"
import { PnLKpiStrip } from "./pnl-kpi-strip"
import { PnLChannelDonut } from "./pnl-channel-donut"
import { PnLTrendChart } from "./pnl-trend-chart"
import { PnLSummaryTable } from "./pnl-summary-table"
import { PnLTable } from "./pnl-table"
import { getStorePnL } from "@/app/actions/store-actions"

export interface PnLPageClientProps {
  storeId: string
  storeName: string
  allStores: Array<{ id: string; name: string }>
}

export function PnLPageClient({ storeId, storeName, allStores }: PnLPageClientProps) {
  const [state, setState] = useState<PnLRangeState>(defaultPnLRangeState)
  const [detailOpen, setDetailOpen] = useState(false)

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

  const configureHref = `/dashboard/stores/${storeId}/edit`
  const data = query.data

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
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard/pnl">P&amp;L</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{storeName}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
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
                  label: "Labor + Rent",
                  value: data.kpis.laborPlusRent,
                  percentOfSales:
                    data.kpis.grossSales === 0
                      ? 0
                      : data.kpis.laborPlusRent / data.kpis.grossSales,
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
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
