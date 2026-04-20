"use client"

import { useTransition, useState, useCallback, useEffect, useMemo } from "react"
import { getMenuPerformanceAnalytics } from "@/app/actions/store-actions"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../components/editorial-topbar"
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
import { MenuDailyTrendChart } from "@/components/charts/menu-daily-trend-chart"
import { CategoryBreakdownChart } from "@/components/charts/category-breakdown-chart"
import { ChannelComparisonChart } from "@/components/charts/channel-comparison-chart"
import { MenuItemsTable } from "@/components/analytics/menu-items-table"
import { ItemHeatmap } from "@/components/charts/item-heatmap"
import { RankingRaceChart } from "@/components/charts/ranking-race-chart"

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
      <EditorialTopbar
        section="§ 08"
        title="Menu Performance"
        stamps={
          data?.dateRange ? (
            <span>
              {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
            </span>
          ) : undefined
        }
      >
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
          <OtterSyncButton lastSyncAt={null} variant="outline" size="sm" />
        )}
      </EditorialTopbar>

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
