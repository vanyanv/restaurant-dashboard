"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import { getProductUsageData } from "@/app/actions/product-usage-actions"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { ChartSkeleton } from "@/components/skeletons"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import { WeeklyComparisonPanel } from "./weekly-comparison-panel"
import { AiInsightsPanel } from "./ai-insights-panel"
import { DemandForecastPanel } from "./demand-forecast-panel"
import type { ProductUsageData } from "@/types/product-usage"

interface AiAnalyticsContentProps {
  initialData: ProductUsageData | null
  stores: { id: string; name: string }[]
}

export function AiAnalyticsContent({
  initialData,
  stores,
}: AiAnalyticsContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setData(initialData)
  }, [initialData])

  const [days, setDays] = useState(30)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")

  const fetchData = useCallback(
    (storeId: string, options: { startDate: string; endDate: string } | { days: number }) => {
      startTransition(async () => {
        const sid = storeId === "all" ? undefined : storeId
        const opts: Record<string, unknown> = { ...options }
        if (sid) opts.storeId = sid
        const fresh = await getProductUsageData(opts as any)
        setData(fresh)
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

  const hasData = !isPending && data

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 07"
        title="AI Analytics"
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
      </EditorialTopbar>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <DashboardSection title="Weekly Comparison">
          <div className="rounded-lg border bg-card p-4">
            <WeeklyComparisonPanel
              storeId={selectedStore !== "all" ? selectedStore : undefined}
            />
          </div>
        </DashboardSection>

        <DashboardSection title="AI Insights">
          <div className="rounded-lg border bg-card p-4">
            {hasData ? (
              <AiInsightsPanel data={data} />
            ) : (
              <ChartSkeleton />
            )}
          </div>
        </DashboardSection>

        <DashboardSection title="Demand Forecast">
          <div className="rounded-lg border bg-card p-4">
            <DemandForecastPanel
              storeId={selectedStore !== "all" ? selectedStore : undefined}
            />
          </div>
        </DashboardSection>
      </div>
    </div>
  )
}
