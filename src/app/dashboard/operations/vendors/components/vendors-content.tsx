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
import { CollapsibleSection } from "@/components/analytics/collapsible-section"
import { ChartSkeleton, DataTableSkeleton } from "@/components/skeletons"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import { PriceChangesTable } from "./price-changes-table"
import type { ProductUsageData } from "@/types/product-usage"

const VendorPriceChart = dynamic(
  () => import("./vendor-price-chart").then(m => ({ default: m.VendorPriceChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface VendorsContentProps {
  initialData: ProductUsageData | null
  stores: { id: string; name: string }[]
}

export function VendorsContent({ initialData, stores }: VendorsContentProps) {
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
        section="§ 04"
        title="Vendors"
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
        <CollapsibleSection title="Price Changes" defaultOpen>
          {hasData ? (
            <PriceChangesTable data={data.priceAlerts} />
          ) : (
            <DataTableSkeleton columns={6} rows={8} />
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Vendor Price Trends" defaultOpen>
          {hasData ? (
            <VendorPriceChart data={data.vendorPriceTrends} />
          ) : (
            <ChartSkeleton />
          )}
        </CollapsibleSection>
      </div>
    </div>
  )
}
