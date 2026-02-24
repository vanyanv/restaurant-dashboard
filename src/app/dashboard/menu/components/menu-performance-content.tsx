"use client"

import { useTransition, useState, useCallback, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import { UtensilsCrossed } from "lucide-react"
import { getMenuPerformanceAnalytics } from "@/app/actions/store-actions"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { CollapsibleSection } from "@/components/analytics/collapsible-section"
import { MenuKpiCards } from "@/components/charts/menu-kpi-cards"
import { ItemExplorerSheet } from "./item-explorer-sheet"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  PieChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import type { MenuPerformanceData } from "@/types/analytics"

const MenuDailyTrendChart = dynamic(
  () => import("@/components/charts/menu-daily-trend-chart").then(m => ({ default: m.MenuDailyTrendChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const CategoryBreakdownChart = dynamic(
  () => import("@/components/charts/category-breakdown-chart").then(m => ({ default: m.CategoryBreakdownChart })),
  { loading: () => <PieChartSkeleton />, ssr: false }
)
const ChannelComparisonChart = dynamic(
  () => import("@/components/charts/channel-comparison-chart").then(m => ({ default: m.ChannelComparisonChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const MenuItemsTable = dynamic(
  () => import("@/components/analytics/menu-items-table").then(m => ({ default: m.MenuItemsTable })),
  { loading: () => <DataTableSkeleton columns={10} rows={8} />, ssr: false }
)
const ItemHeatmap = dynamic(
  () => import("@/components/charts/item-heatmap").then(m => ({ default: m.ItemHeatmap })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const RankingRaceChart = dynamic(
  () => import("@/components/charts/ranking-race-chart").then(m => ({ default: m.RankingRaceChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface MenuPerformanceContentProps {
  initialData: MenuPerformanceData | null
  stores: { id: string; name: string }[]
  userRole: string
}

export function MenuPerformanceContent({
  initialData,
  stores,
  userRole,
}: MenuPerformanceContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { setData(initialData) }, [initialData])

  const [days, setDays] = useState(7)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")
  const [selectedItem, setSelectedItem] = useState<{
    itemName: string
    category: string
  } | null>(null)

  const fetchData = useCallback(
    (storeId: string, options: { startDate: string; endDate: string } | { days: number }) => {
      startTransition(async () => {
        const sid = storeId === "all" ? undefined : storeId
        const result = await getMenuPerformanceAnalytics(sid, options)
        if (result) setData(result)
      })
    },
    []
  )

  const getDateOptions = useCallback((): { startDate: string; endDate: string } | { days: number } => {
    if (customRange) return customRange
    return { days }
  }, [customRange, days])

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

      fetchData(selectedStore, { startDate, endDate })
    },
    [selectedStore, fetchData]
  )

  const handleStoreChange = useCallback(
    (storeId: string) => {
      setSelectedStore(storeId)
      fetchData(storeId, getDateOptions())
    },
    [fetchData, getDateOptions]
  )

  const handleItemClick = useCallback((itemName: string, category: string) => {
    setSelectedItem({ itemName, category })
  }, [])

  const handleCloseExplorer = useCallback(() => {
    setSelectedItem(null)
  }, [])

  // Build dateOptions for the explorer sheet
  const explorerDateOptions = useMemo(() => {
    if (customRange) return customRange
    return { days }
  }, [customRange, days])

  const hasData = !isPending && data

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
                <BreadcrumbPage>Menu Performance</BreadcrumbPage>
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
              <UtensilsCrossed className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Menu Performance
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
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DateRangePicker
              days={days}
              customRange={customRange}
              onRangeChange={handleRangeChange}
              isPending={isPending}
            />
            {stores.length > 1 && (
              <Select value={selectedStore} onValueChange={handleStoreChange}>
                <SelectTrigger className="h-8 w-[140px] text-sm">
                  <SelectValue placeholder="All Stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {userRole === "OWNER" && (
              <OtterSyncButton
                lastSyncAt={null}
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
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-8">
        {/* KPI Cards (not collapsible) */}
        <DashboardSection title="Overview">
          {isPending ? (
            <KpiCardsSkeleton />
          ) : hasData ? (
            <MenuKpiCards kpis={data.kpis} comparison={data.comparison} />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No menu data available for this period.
            </div>
          )}
        </DashboardSection>

        {/* Daily Trend + Category Breakdown */}
        {(isPending || hasData) && (
          <CollapsibleSection title="Trends & Categories" defaultOpen>
            <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
              {isPending ? (
                <>
                  <ChartSkeleton className="lg:col-span-3" />
                  <PieChartSkeleton className="lg:col-span-2" />
                </>
              ) : hasData ? (
                <>
                  <MenuDailyTrendChart
                    data={data.dailyTrends}
                    className="lg:col-span-3"
                  />
                  <CategoryBreakdownChart
                    data={data.categoryBreakdown}
                    className="lg:col-span-2"
                  />
                </>
              ) : null}
            </div>
          </CollapsibleSection>
        )}

        {/* Item Heatmap */}
        {(isPending || hasData) && (
          <CollapsibleSection title="Item Heatmap" defaultOpen>
            {isPending ? (
              <ChartSkeleton />
            ) : hasData && data.itemDailyMatrix.length > 0 ? (
              <ItemHeatmap
                matrix={data.itemDailyMatrix}
                itemNames={data.matrixItemNames}
                dateRange={data.dateRange}
                onItemClick={handleItemClick}
              />
            ) : null}
          </CollapsibleSection>
        )}

        {/* Ranking Race (replaces Top Items) */}
        {(isPending || hasData) && (
          <CollapsibleSection title="Top Sellers" defaultOpen={false}>
            {isPending ? (
              <ChartSkeleton />
            ) : hasData && data.raceDayFrames.length > 0 ? (
              <RankingRaceChart
                frames={data.raceDayFrames}
                onItemClick={handleItemClick}
              />
            ) : null}
          </CollapsibleSection>
        )}

        {/* Channel Comparison */}
        {(isPending || hasData) && (
          <CollapsibleSection title="Channel Analysis" defaultOpen={false}>
            {isPending ? (
              <ChartSkeleton />
            ) : hasData ? (
              <ChannelComparisonChart data={data.channelComparison} />
            ) : null}
          </CollapsibleSection>
        )}

        {/* Detailed Items Table */}
        {(isPending || hasData) && (
          <CollapsibleSection title="Detailed Breakdown" defaultOpen>
            {isPending ? (
              <DataTableSkeleton columns={10} rows={8} />
            ) : hasData ? (
              <MenuItemsTable
                data={data.allItems}
                onItemClick={handleItemClick}
              />
            ) : null}
          </CollapsibleSection>
        )}
      </div>

      {/* Item Explorer Sheet */}
      <ItemExplorerSheet
        itemName={selectedItem?.itemName ?? null}
        category={selectedItem?.category ?? null}
        storeId={selectedStore === "all" ? undefined : selectedStore}
        dateOptions={explorerDateOptions}
        onClose={handleCloseExplorer}
      />
    </div>
  )
}
