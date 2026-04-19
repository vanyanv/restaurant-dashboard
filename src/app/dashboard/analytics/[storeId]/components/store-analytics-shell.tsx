import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft, Store, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  DataTableSkeleton,
  MenuCategoryTableSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"
import { DateRangeUrlControls } from "@/components/analytics/date-range-url-controls"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { StoreSelector } from "./store-selector"
import { StoreKpisSection } from "./sections/store-kpis-section"
import { StoreRevenueSection } from "./sections/store-revenue-section"
import { StorePlatformTrendSection } from "./sections/store-platform-trend-section"
import { StoreOrderPatternsSection } from "./sections/store-order-patterns-section"
import { StorePlatformBreakdownSection } from "./sections/store-platform-breakdown-section"
import { StoreFinancialTableSection } from "./sections/store-financial-table-section"
import { StoreAdditionalMetricsSection } from "./sections/store-additional-metrics-section"
import { StoreMenuSection } from "./sections/store-menu-section"
import { StoreDailyTableSection } from "./sections/store-daily-table-section"
import { StoreSyncButton } from "./sections/store-sync-button"

interface StoreAnalyticsShellProps {
  store: { id: string; name: string }
  allStores: { id: string; name: string }[]
  range: DashboardRange
}

export function StoreAnalyticsShell({
  store,
  allStores,
  range,
}: StoreAnalyticsShellProps) {
  const basePath = `/dashboard/analytics/${store.id}`

  return (
    <div>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/dashboard/analytics">
                Analytics
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{store.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/analytics">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-1.5">
            <Store className="h-4 w-4 text-muted-foreground" />
            <StoreSelector currentStoreId={store.id} allStores={allStores} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DateRangeUrlControls range={range} basePath={basePath} />
          <Link href={`/dashboard/pnl/${store.id}`}>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <Receipt className="mr-1 h-3.5 w-3.5" />
              P&amp;L
            </Button>
          </Link>
          <Suspense fallback={<Skeleton className="h-8 w-20 rounded-md" />}>
            <StoreSyncButton storeId={store.id} range={range} />
          </Suspense>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <SectionErrorBoundary label="KPIs unavailable">
          <Suspense fallback={<KpiCardsSkeleton />}>
            <StoreKpisSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Revenue charts unavailable">
          <Suspense
            fallback={
              <div className="grid gap-4 md:grid-cols-5">
                <ChartSkeleton
                  height="h-[280px] md:h-[340px] lg:h-[380px]"
                  showToggle
                  className="md:col-span-3"
                />
                <HeatmapSkeleton className="md:col-span-2" />
              </div>
            }
          >
            <StoreRevenueSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Platform trend unavailable">
          <Suspense
            fallback={
              <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
            }
          >
            <StorePlatformTrendSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Order patterns unavailable">
          <Suspense
            fallback={
              <div className="grid gap-4 md:grid-cols-3">
                <ChartSkeleton />
                <ChartSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <StoreOrderPatternsSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Platform breakdown unavailable">
          <Suspense
            fallback={
              <div className="grid gap-4 md:grid-cols-2">
                <ChartSkeleton />
                <PieChartSkeleton />
              </div>
            }
          >
            <StorePlatformBreakdownSection
              storeId={store.id}
              range={range}
            />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Financial table unavailable">
          <Suspense fallback={<DataTableSkeleton columns={16} rows={5} />}>
            <StoreFinancialTableSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Additional metrics unavailable">
          <Suspense fallback={<AdditionalMetricsSkeleton />}>
            <StoreAdditionalMetricsSection
              storeId={store.id}
              range={range}
            />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Menu analytics unavailable">
          <Suspense
            fallback={
              <div className="grid gap-4 md:grid-cols-2">
                <ChartSkeleton />
                <MenuCategoryTableSkeleton />
              </div>
            }
          >
            <StoreMenuSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Daily table unavailable">
          <Suspense fallback={<DataTableSkeleton columns={7} rows={7} />}>
            <StoreDailyTableSection storeId={store.id} range={range} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  )
}
