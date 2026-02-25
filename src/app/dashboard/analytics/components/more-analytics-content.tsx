"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { BarChart3 } from "lucide-react"
import { getDashboardAnalytics, getOtterAnalytics, getMenuCategoryAnalytics } from "@/app/actions/store-actions"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { AdditionalMetrics } from "@/components/analytics/additional-metrics"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { formatDateRange, getLastSyncText, localDateStr } from "@/lib/dashboard-utils"
import { PlatformInsights } from "@/components/analytics/platform-insights"
import {
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"
import type { DashboardData, StoreAnalyticsData, MenuCategoryData } from "@/types/analytics"

const RevenueHeatmap = dynamic(
  () => import("@/components/charts/revenue-heatmap").then(m => ({ default: m.RevenueHeatmap })),
  { loading: () => <HeatmapSkeleton />, ssr: false }
)
const PlatformTrendChart = dynamic(
  () => import("@/components/charts/platform-trend-chart").then(m => ({ default: m.PlatformTrendChart })),
  { loading: () => <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />, ssr: false }
)
const PlatformBreakdownChart = dynamic(
  () => import("@/components/charts/platform-breakdown-chart").then(m => ({ default: m.PlatformBreakdownChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const PaymentSplitChart = dynamic(
  () => import("@/components/charts/payment-split-chart").then(m => ({ default: m.PaymentSplitChart })),
  { loading: () => <PieChartSkeleton />, ssr: false }
)
const TopItemsChart = dynamic(
  () => import("@/components/charts/top-items-chart").then(m => ({ default: m.TopItemsChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const StoreComparisonChart = dynamic(
  () => import("@/components/charts/store-comparison-chart").then(m => ({ default: m.StoreComparisonChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface MoreAnalyticsContentProps {
  initialData: DashboardData | null
  initialOtterData: StoreAnalyticsData | null
  initialMenuData: MenuCategoryData | null
  userRole: string
}

export function MoreAnalyticsContent({
  initialData,
  initialOtterData,
  initialMenuData,
  userRole,
}: MoreAnalyticsContentProps) {
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

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const presets = [1, -1, 3, 7, 14, 30, 90]
      const matchedPreset = presets.find((p) => p === presetDays)

      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      startTransition(async () => {
        const [dashResult, otterResult, menuResult] = await Promise.all([
          getDashboardAnalytics({ startDate, endDate }),
          getOtterAnalytics(undefined, { startDate, endDate }),
          getMenuCategoryAnalytics(undefined, { startDate, endDate }),
        ])
        if (dashResult) setData(dashResult)
        setOtterData(otterResult)
        if (menuResult) setMenuData(menuResult)
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
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Analytics</BreadcrumbPage>
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
                Detailed Analytics
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

      {/* Analytics Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-8">
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
          {hasOtterData && (
            <PlatformInsights data={otterData.platformBreakdown} />
          )}
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
        ) : hasData && data.rows.length > 1 ? (
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
    </div>
  )
}
