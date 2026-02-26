"use client"

import { useTransition, useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Store, ArrowLeft, BarChart3 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { getOtterAnalytics, getMenuCategoryAnalytics, getOrderPatterns } from "@/app/actions/store-actions"
import { localDateStr } from "@/lib/dashboard-utils"
import type { StoreAnalyticsData, MenuCategoryData, OrderPatternsData } from "@/types/analytics"

import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { KpiCards } from "@/components/analytics/kpi-cards"
import { FinancialTable } from "@/components/analytics/financial-table"
import { DailyTable } from "@/components/analytics/daily-table"
import { AdditionalMetrics } from "@/components/analytics/additional-metrics"
import { OtterSyncButton } from "@/components/otter-sync-button"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  DataTableSkeleton,
  MenuCategoryTableSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"

const RevenueTrendChart = dynamic(
  () => import("@/components/charts/revenue-trend-chart").then(m => ({ default: m.RevenueTrendChart })),
  { loading: () => <ChartSkeleton height="h-[280px] md:h-[340px] lg:h-[380px]" showToggle />, ssr: false }
)
const PlatformBreakdownChart = dynamic(
  () => import("@/components/charts/platform-breakdown-chart").then(m => ({ default: m.PlatformBreakdownChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const PaymentSplitChart = dynamic(
  () => import("@/components/charts/payment-split-chart").then(m => ({ default: m.PaymentSplitChart })),
  { loading: () => <PieChartSkeleton />, ssr: false }
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
const MenuCategoryTable = dynamic(
  () => import("@/components/analytics/menu-category-table").then(m => ({ default: m.MenuCategoryTable })),
  { loading: () => <MenuCategoryTableSkeleton />, ssr: false }
)
const HourlyOrdersChart = dynamic(
  () => import("@/components/charts/hourly-orders-chart").then(m => ({ default: m.HourlyOrdersChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const DayOfWeekChart = dynamic(
  () => import("@/components/charts/day-of-week-chart").then(m => ({ default: m.DayOfWeekChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const MonthlyOrdersChart = dynamic(
  () => import("@/components/charts/monthly-orders-chart").then(m => ({ default: m.MonthlyOrdersChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface StoreAnalyticsContentProps {
  store: { id: string; name: string; address?: string | null; phone?: string | null }
  allStores: Array<{ id: string; name: string }>
  analytics: StoreAnalyticsData
  menuData: MenuCategoryData | null
}

export function StoreAnalyticsContent({
  store,
  allStores,
  analytics: initialAnalytics,
  menuData: initialMenuData,
}: StoreAnalyticsContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [analytics, setAnalytics] = useState(initialAnalytics)
  const [menuCategoryData, setMenuCategoryData] = useState(initialMenuData)
  const [days, setDays] = useState(30)

  const [orderPatterns, setOrderPatterns] = useState<OrderPatternsData | null>(null)
  const [patternsLoading, setPatternsLoading] = useState(true)

  useEffect(() => { setAnalytics(initialAnalytics) }, [initialAnalytics])
  useEffect(() => { setMenuCategoryData(initialMenuData) }, [initialMenuData])

  // Lazy-load order patterns on mount (external API call, don't block SSR)
  useEffect(() => {
    setPatternsLoading(true)
    getOrderPatterns(store.id)
      .then(setOrderPatterns)
      .finally(() => setPatternsLoading(false))
  }, [store.id])

  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)

  const handleStoreChange = (newStoreId: string) => {
    if (newStoreId === "all") {
      router.push("/dashboard/analytics")
    } else {
      router.push(`/dashboard/analytics/${newStoreId}`)
    }
  }

  const handleRangeChange = (startDate: string, endDate: string) => {
    const diffDays = Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24)
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
      const [result, menuResult, patternsResult] = await Promise.all([
        getOtterAnalytics(store.id, { startDate, endDate }),
        getMenuCategoryAnalytics(store.id, { startDate, endDate }),
        getOrderPatterns(store.id, { startDate, endDate }),
      ])
      if (result) {
        setAnalytics(result)
      }
      setMenuCategoryData(menuResult)
      setOrderPatterns(patternsResult)
    })
  }

  return (
    <div>
      {/* Header */}
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
              <BreadcrumbLink href="/dashboard/analytics">Analytics</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{store.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/analytics">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-1.5">
            <Store className="h-4 w-4 text-muted-foreground" />
            <Select value={store.id} onValueChange={handleStoreChange}>
              <SelectTrigger className="h-8 w-[140px] sm:w-[180px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5" />
                    All Stores
                  </div>
                </SelectItem>
                {allStores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DateRangePicker
            days={days}
            customRange={customRange}
            onRangeChange={handleRangeChange}
            isPending={isPending}
          />
          <OtterSyncButton lastSyncAt={analytics.lastSyncAt} />
        </div>
      </div>

      {/* Dashboard body */}
      <div className="flex flex-col gap-4 p-4">
        {/* KPI row */}
        {isPending ? (
          <KpiCardsSkeleton />
        ) : (
          <KpiCards kpis={analytics.kpis} comparison={analytics.comparison} />
        )}

        {/* Revenue trend + heatmap */}
        <div className="grid gap-4 md:grid-cols-5">
          {isPending ? (
            <>
              <ChartSkeleton height="h-[280px] md:h-[340px] lg:h-[380px]" showToggle className="md:col-span-3" />
              <HeatmapSkeleton className="md:col-span-2" />
            </>
          ) : (
            <>
              <RevenueTrendChart className="md:col-span-3" />
              <RevenueHeatmap data={analytics.dailyTrends} className="md:col-span-2" />
            </>
          )}
        </div>

        {/* Platform trends over time */}
        {isPending ? (
          <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
        ) : (
          <PlatformTrendChart data={analytics.platformTrends} />
        )}

        {/* Order patterns: busiest hours, days, months */}
        <div className="grid gap-4 md:grid-cols-3">
          {(isPending || patternsLoading) ? (
            <>
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
            </>
          ) : orderPatterns ? (
            <>
              <HourlyOrdersChart data={orderPatterns.hourly} />
              <DayOfWeekChart data={orderPatterns.byDayOfWeek} />
              <MonthlyOrdersChart data={orderPatterns.byMonth} />
            </>
          ) : null}
        </div>

        {/* Platform breakdown + Payment split */}
        <div className="grid gap-4 md:grid-cols-2">
          {isPending ? (
            <>
              <ChartSkeleton />
              <PieChartSkeleton />
            </>
          ) : (
            <>
              <PlatformBreakdownChart data={analytics.platformBreakdown} />
              <PaymentSplitChart data={analytics.paymentSplit} />
            </>
          )}
        </div>

        {/* Financial table */}
        {isPending ? (
          <DataTableSkeleton columns={16} rows={5} />
        ) : (
          <FinancialTable data={analytics.platformBreakdown} />
        )}

        {/* Additional metrics */}
        {isPending ? (
          <AdditionalMetricsSkeleton />
        ) : (
          <AdditionalMetrics kpis={analytics.kpis} />
        )}

        {/* Menu: top items + category table */}
        {isPending ? (
          <div className="grid gap-4 md:grid-cols-2">
            <ChartSkeleton />
            <MenuCategoryTableSkeleton />
          </div>
        ) : menuCategoryData ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TopItemsChart data={menuCategoryData} />
            <MenuCategoryTable data={menuCategoryData} />
          </div>
        ) : null}

        {/* Daily table */}
        {isPending ? (
          <DataTableSkeleton columns={7} rows={7} />
        ) : (
          <DailyTable data={analytics.dailyTrends} />
        )}
      </div>
    </div>
  )
}
