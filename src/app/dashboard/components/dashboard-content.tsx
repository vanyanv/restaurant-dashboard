"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { BarChart3, ChevronDown } from "lucide-react"
import { getDashboardAnalytics, getOtterAnalytics } from "@/app/actions/store-actions"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import {
  FinancialSummaryTable,
  FinancialSummaryTableSkeleton,
} from "./financial-summary-table"
import { KpiCards } from "@/components/analytics/kpi-cards"
import { DayHighlights } from "@/components/analytics/day-highlights"
import { PlatformInsights } from "@/components/analytics/platform-insights"
import { AdditionalMetrics } from "@/components/analytics/additional-metrics"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  MenuCategoryTableSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"
import type { DashboardData, StoreAnalyticsData, MenuCategoryData } from "@/types/analytics"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

const RevenueTrendChart = dynamic(
  () => import("@/components/charts/revenue-trend-chart").then(m => ({ default: m.RevenueTrendChart })),
  { loading: () => <ChartSkeleton height="h-[250px] md:h-[280px] lg:h-[300px]" showToggle />, ssr: false }
)
import { MenuCategorySalesCard } from "@/components/analytics/menu-category-sales-card"
const PlatformBreakdownChart = dynamic(
  () => import("@/components/charts/platform-breakdown-chart").then(m => ({ default: m.PlatformBreakdownChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const PaymentSplitChart = dynamic(
  () => import("@/components/charts/payment-split-chart").then(m => ({ default: m.PaymentSplitChart })),
  { loading: () => <PieChartSkeleton />, ssr: false }
)
const StoreComparisonChart = dynamic(
  () => import("@/components/charts/store-comparison-chart").then(m => ({ default: m.StoreComparisonChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const RevenueHeatmap = dynamic(
  () => import("@/components/charts/revenue-heatmap").then(m => ({ default: m.RevenueHeatmap })),
  { loading: () => <HeatmapSkeleton />, ssr: false }
)
const TopItemsChart = dynamic(
  () => import("@/components/charts/top-items-chart").then(m => ({ default: m.TopItemsChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const PlatformTrendChart = dynamic(
  () => import("@/components/charts/platform-trend-chart").then(m => ({ default: m.PlatformTrendChart })),
  { loading: () => <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />, ssr: false }
)

interface DashboardContentProps {
  initialData: DashboardData | null
  initialOtterData: StoreAnalyticsData | null
  initialMenuData: MenuCategoryData | null
  userRole: string
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  if (startDate === endDate) {
    return format(start, "MMM d, yyyy")
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`
}

function getLastSyncText(lastSyncAt: Date | string | null | undefined): string {
  if (!lastSyncAt) return "Never synced"
  const date =
    typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just synced"
  if (diffMin < 60) return `Last synced ${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Last synced ${diffHours}h ago`
  return `Last synced ${Math.floor(diffHours / 24)}d ago`
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center py-2">
      <div className="flex-1 border-t border-border" />
      <span className="mx-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}

function DashboardSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <h2 className="text-base font-semibold tracking-tight text-foreground/80">{title}</h2>
      {children}
    </section>
  )
}

export function DashboardContent({
  initialData,
  initialOtterData,
  initialMenuData,
  userRole,
}: DashboardContentProps) {
  const [data, setData] = useState(initialData)
  const [otterData, setOtterData] = useState(initialOtterData)
  const [menuData, setMenuData] = useState(initialMenuData)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { setData(initialData) }, [initialData])
  useEffect(() => { setOtterData(initialOtterData) }, [initialOtterData])
  useEffect(() => { setMenuData(initialMenuData) }, [initialMenuData])
  const [days, setDays] = useState(1)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [showMore, setShowMore] = useState(false)

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const end = new Date(endDate + "T23:59:59")
      const start = new Date(startDate + "T00:00:00")
      const diffDays = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      )
      const presets = [1, 3, 7, 14, 30, 90]
      const matchedPreset = presets.find((p) => p === diffDays)

      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      startTransition(async () => {
        const [dashResult, otterResult] = await Promise.all([
          getDashboardAnalytics({ startDate, endDate }),
          getOtterAnalytics(undefined, { startDate, endDate }),
        ])
        if (dashResult) setData(dashResult)
        setOtterData(otterResult)
      })
    },
    []
  )

  const hasData = data && data.rows.length > 0
  const hasOtterData = !isPending && otterData

  return (
    <div className="flex flex-col h-full">
      {/* Navigation Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Sales Summary</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Sales Summary
              </h1>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
              {data?.dateRange && (
                <span>
                  {formatDateRange(
                    data.dateRange.startDate,
                    data.dateRange.endDate
                  )}
                </span>
              )}
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
              <span>{getLastSyncText(data?.lastSyncAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DateRangePicker
              days={days}
              customRange={customRange}
              onRangeChange={handleRangeChange}
              isPending={isPending}
            />
            {userRole === "OWNER" && (
              <OtterSyncButton
                lastSyncAt={data?.lastSyncAt}
                variant="outline"
                size="sm"
              />
            )}
          </div>
        </div>

        {/* Mobile date info */}
        <div className="sm:hidden px-4 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {data?.dateRange && (
            <span>
              {formatDateRange(
                data.dateRange.startDate,
                data.dateRange.endDate
              )}
            </span>
          )}
          <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
          <span>{getLastSyncText(data?.lastSyncAt)}</span>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-6">
        {/* === PRIMARY SECTION: KPIs → Day Highlights → Chart + Menu → Platform Insights → Table === */}

        {/* 1. KPI Cards */}
        {isPending && !otterData ? (
          <KpiCardsSkeleton />
        ) : hasOtterData ? (
          <KpiCards kpis={otterData.kpis} comparison={otterData.comparison} />
        ) : null}

        {/* 2. Day Highlights (best/worst day) */}
        {hasOtterData && otterData.dailyTrends.length > 1 && (
          <DayHighlights dailyTrends={otterData.dailyTrends} />
        )}

        {/* 3. Revenue Trend + Menu Category (side-by-side on desktop) */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
          <RevenueTrendChart compact className="lg:col-span-3" />
          {isPending ? (
            <MenuCategoryTableSkeleton className="lg:col-span-2" />
          ) : menuData ? (
            <MenuCategorySalesCard
              data={menuData}
              stores={
                data?.rows
                  .filter((r) => r.storeId !== "total")
                  .map((r) => ({ id: r.storeId, name: r.storeName })) ?? []
              }
              className="lg:col-span-2"
            />
          ) : null}
        </div>

        {/* 4. Sales Breakdown Table */}
        {isPending ? (
          <FinancialSummaryTableSkeleton />
        ) : hasData ? (
          <FinancialSummaryTable rows={data.rows} totals={data.totals} channelRows={data.channelRows} />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">
              No financial data yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Sync your Otter data to see financial summaries across all
              locations. Click the sync button above to get started.
            </p>
          </div>
        )}

        {/* 5. Platform Insights (AOV + Fee % per platform) */}
        {hasOtterData && (
          <PlatformInsights data={otterData.platformBreakdown} />
        )}

        {/* === SECONDARY SECTION: More Analytics === */}
        {(hasOtterData || isPending) && (
          <>
            <SectionDivider label="More Analytics" />

            <button
              onClick={() => setShowMore(!showMore)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              {showMore ? "Hide" : "Show"} detailed analytics
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  showMore && "rotate-180"
                )}
              />
            </button>

            {showMore && (
              <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                {/* Revenue Trends */}
                <DashboardSection title="Revenue Trends">
                  <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
                    {isPending ? (
                      <HeatmapSkeleton className="lg:col-span-5" />
                    ) : hasOtterData ? (
                      <RevenueHeatmap
                        data={otterData.dailyTrends}
                        className="lg:col-span-5"
                      />
                    ) : null}
                  </div>
                </DashboardSection>

                {/* Platform Analysis */}
                <DashboardSection title="Platform Analysis">
                  {isPending ? (
                    <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
                  ) : hasOtterData ? (
                    <PlatformTrendChart data={otterData.platformTrends} />
                  ) : null}
                  <div className="grid gap-4 md:gap-6 md:grid-cols-3">
                    {isPending ? (
                      <>
                        <ChartSkeleton className="md:col-span-2" />
                        <PieChartSkeleton />
                      </>
                    ) : hasOtterData ? (
                      <>
                        <PlatformBreakdownChart
                          data={otterData.platformBreakdown}
                          className="md:col-span-2"
                        />
                        <PaymentSplitChart data={otterData.paymentSplit} />
                      </>
                    ) : null}
                  </div>
                </DashboardSection>

                {/* Top Menu Items */}
                {isPending ? (
                  <DashboardSection title="Top Menu Items">
                    <ChartSkeleton />
                  </DashboardSection>
                ) : menuData ? (
                  <DashboardSection title="Top Menu Items">
                    <TopItemsChart data={menuData} />
                  </DashboardSection>
                ) : null}

                {/* Store Comparison */}
                {isPending ? (
                  <DashboardSection title="Store Comparison">
                    <ChartSkeleton />
                  </DashboardSection>
                ) : data && data.rows.length > 1 ? (
                  <DashboardSection title="Store Comparison">
                    <StoreComparisonChart
                      data={data.rows
                        .filter((r) => r.storeId !== "total")
                        .map((r) => ({
                          storeName: r.storeName,
                          grossSales: r.grossSales,
                          netSales: r.netSales,
                        }))}
                    />
                  </DashboardSection>
                ) : null}

                {/* Additional Metrics */}
                <DashboardSection title="Additional Metrics">
                  {isPending ? (
                    <AdditionalMetricsSkeleton />
                  ) : hasOtterData ? (
                    <AdditionalMetrics kpis={otterData.kpis} />
                  ) : null}
                </DashboardSection>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
