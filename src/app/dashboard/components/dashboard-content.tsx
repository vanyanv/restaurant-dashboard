"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { BarChart3, Store } from "lucide-react"
import { getDashboardAnalytics, getOtterAnalytics, getMenuCategoryAnalytics } from "@/app/actions/store-actions"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  FinancialSummaryTable,
  FinancialSummaryTableSkeleton,
} from "./financial-summary-table"
import { KpiCards } from "@/components/analytics/kpi-cards"
import { DayHighlights } from "@/components/analytics/day-highlights"
import { InvoiceSnapshot } from "@/components/analytics/invoice-snapshot"
import { MenuCategorySalesCard } from "@/components/analytics/menu-category-sales-card"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  MenuCategoryTableSkeleton,
} from "@/components/skeletons"
import { formatDateRange, getLastSyncText, localDateStr } from "@/lib/dashboard-utils"
import type { DashboardData, StoreAnalyticsData, MenuCategoryData } from "@/types/analytics"
import type { InvoiceKpis, InvoiceListItem } from "@/types/invoice"

const RevenueTrendChart = dynamic(
  () => import("@/components/charts/revenue-trend-chart").then(m => ({ default: m.RevenueTrendChart })),
  { loading: () => <ChartSkeleton height="h-[200px] md:h-[220px] lg:h-[240px]" showToggle />, ssr: false }
)

interface DashboardContentProps {
  initialData: DashboardData | null
  initialOtterData: StoreAnalyticsData | null
  initialMenuData: MenuCategoryData | null
  initialInvoiceSummary: InvoiceKpis | null
  initialRecentInvoices: InvoiceListItem[]
  userRole: string
}

export function DashboardContent({
  initialData,
  initialOtterData,
  initialMenuData,
  initialInvoiceSummary,
  initialRecentInvoices,
  userRole,
}: DashboardContentProps) {
  const router = useRouter()
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
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-3 sm:px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
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
              <span suppressHydrationWarning>{getLastSyncText(data?.lastSyncAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile: store quick-nav */}
            {data?.rows && data.rows.filter(r => r.storeId !== "total").length > 1 && (
              <Select onValueChange={(storeId) => router.push(`/dashboard/analytics/${storeId}`)}>
                <SelectTrigger className="sm:hidden h-8 w-8 px-0 justify-center [&>svg:last-child]:hidden">
                  <Store className="h-3.5 w-3.5" />
                </SelectTrigger>
                <SelectContent>
                  {data.rows
                    .filter((r) => r.storeId !== "total")
                    .map((r) => (
                      <SelectItem key={r.storeId} value={r.storeId}>
                        {r.storeName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
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
        <div className="sm:hidden px-3 pb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {data?.dateRange && (
            <span>
              {formatDateRange(
                data.dateRange.startDate,
                data.dateRange.endDate
              )}
            </span>
          )}
          <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
          <span suppressHydrationWarning>{getLastSyncText(data?.lastSyncAt)}</span>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="flex-1 p-3 sm:p-4 space-y-3">
        {/* 1. KPI Cards + Day Highlights */}
        <div className="space-y-1.5">
          {isPending && !otterData ? (
            <KpiCardsSkeleton />
          ) : hasOtterData ? (
            <KpiCards kpis={otterData.kpis} comparison={otterData.comparison} />
          ) : null}

          {/* 2. Day Highlights (best/worst day) */}
          {hasOtterData && otterData.dailyTrends.length > 1 && (
            <DayHighlights dailyTrends={otterData.dailyTrends} />
          )}
        </div>

        {/* 3. Revenue Trend + Menu Category (side-by-side on desktop) */}
        <div className="grid gap-3 md:gap-4 lg:grid-cols-5">
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

        {/* 5. Invoice Snapshot (last 30 days) */}
        {initialInvoiceSummary && (
          <InvoiceSnapshot summary={initialInvoiceSummary} recentInvoices={initialRecentInvoices} />
        )}

      </div>
    </div>
  )
}
