"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { getProductUsageData } from "@/app/actions/product-usage-actions"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { CollapsibleSection } from "@/components/analytics/collapsible-section"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import { ProductUsageKpiCards } from "./product-usage-kpi-cards"
import { AlertsBanner } from "./alerts-banner"
import { IngredientVarianceTable } from "./ingredient-variance-table"
import { IngredientDrilldownSheet } from "./ingredient-drilldown-sheet"
import type { ProductUsageData, IngredientUsageRow } from "@/types/product-usage"

const IngredientEfficiencyChart = dynamic(
  () => import("./ingredient-efficiency-chart").then(m => ({ default: m.IngredientEfficiencyChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const CategorySpendChart = dynamic(
  () => import("./category-spend-chart").then(m => ({ default: m.CategorySpendChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface ProductUsageContentProps {
  initialData: ProductUsageData | null
  stores: { id: string; name: string }[]
  userRole: string
}

export function ProductUsageContent({
  initialData,
  stores,
  userRole,
}: ProductUsageContentProps) {
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
  const [selectedIngredient, setSelectedIngredient] = useState<IngredientUsageRow | null>(null)

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
        section="§ 04"
        title="Product Usage"
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
        {hasData && (data.priceAlerts.length > 0 || data.orderAnomalies.length > 0) && (
          <AlertsBanner priceAlerts={data.priceAlerts} orderAnomalies={data.orderAnomalies} />
        )}

        <DashboardSection title="Key Metrics">
          {hasData ? <ProductUsageKpiCards kpis={data.kpis} /> : <KpiCardsSkeleton />}
        </DashboardSection>

        <CollapsibleSection title="Ingredient Efficiency" defaultOpen>
          {hasData ? <IngredientEfficiencyChart data={data.ingredientUsage} /> : <ChartSkeleton />}
        </CollapsibleSection>

        <CollapsibleSection title="Category Breakdown" defaultOpen>
          {hasData ? <CategorySpendChart data={data.categoryBreakdown} /> : <ChartSkeleton />}
        </CollapsibleSection>

        <CollapsibleSection title="Ingredient Variance" defaultOpen>
          {hasData ? (
            <IngredientVarianceTable
              data={data.ingredientUsage}
              onRowClick={(name) => {
                const row = data.ingredientUsage.find((i) => i.canonicalName === name)
                if (row) setSelectedIngredient(row)
              }}
            />
          ) : (
            <DataTableSkeleton columns={7} rows={8} />
          )}
        </CollapsibleSection>
      </div>

      <IngredientDrilldownSheet
        ingredient={selectedIngredient}
        recipes={[]}
        onClose={() => setSelectedIngredient(null)}
      />
    </div>
  )
}
