"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { Layers, ChevronDown } from "lucide-react"
import { getProductMixData } from "@/app/actions/store-actions"

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import {
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import type { ProductMixData } from "@/types/analytics"

const ProductMixTreemap = dynamic(
  () => import("@/components/charts/product-mix-treemap").then(m => ({ default: m.ProductMixTreemap })),
  { loading: () => <ChartSkeleton height="h-[350px] md:h-[400px]" />, ssr: false }
)
const QuickInsights = dynamic(
  () => import("@/components/analytics/quick-insights").then(m => ({ default: m.QuickInsights })),
  { loading: () => (
    <div className="flex gap-2">
      <Skeleton className="h-8 w-48 rounded-full" />
      <Skeleton className="h-8 w-56 rounded-full" />
      <Skeleton className="h-8 w-44 rounded-full" />
    </div>
  ), ssr: false }
)
const ParetoChart = dynamic(
  () => import("@/components/charts/pareto-chart").then(m => ({ default: m.ParetoChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const MenuEngineeringMatrix = dynamic(
  () => import("@/components/charts/menu-engineering-matrix").then(m => ({ default: m.MenuEngineeringMatrix })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const ProductMixTable = dynamic(
  () => import("@/components/analytics/product-mix-table").then(m => ({ default: m.ProductMixTable })),
  { loading: () => <DataTableSkeleton columns={10} rows={8} />, ssr: false }
)
const TopMovers = dynamic(
  () => import("@/components/analytics/top-movers").then(m => ({ default: m.TopMovers })),
  { loading: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartSkeleton height="h-[200px]" />
      <ChartSkeleton height="h-[200px]" />
    </div>
  ), ssr: false }
)

interface ProductMixContentProps {
  initialData: ProductMixData | null
  stores: { id: string; name: string }[]
  userRole: string
}

export function ProductMixContent({
  initialData,
  stores,
  userRole,
}: ProductMixContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { setData(initialData) }, [initialData])

  const [days, setDays] = useState(7)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")

  const fetchData = useCallback(
    (storeId: string, options: { startDate: string; endDate: string } | { days: number }) => {
      startTransition(async () => {
        const sid = storeId === "all" ? undefined : storeId
        const result = await getProductMixData(sid, options)
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
                <BreadcrumbPage>Product Mix</BreadcrumbPage>
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
              <Layers className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Product Mix
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
        {/* Treemap Hero */}
        <DashboardSection title="Revenue Distribution">
          {isPending ? (
            <ChartSkeleton height="h-[350px] md:h-[400px]" />
          ) : hasData ? (
            <ProductMixTreemap data={data.treemap} />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No product mix data available for this period.
            </div>
          )}
        </DashboardSection>

        {/* Top Movers — right after treemap */}
        {(isPending || hasData) && (
          <DashboardSection title="Top Movers">
            {isPending ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ChartSkeleton height="h-[200px]" />
                <ChartSkeleton height="h-[200px]" />
              </div>
            ) : hasData ? (
              <TopMovers risers={data.risers} decliners={data.decliners} />
            ) : null}
          </DashboardSection>
        )}

        {/* Quick Insights */}
        {(isPending || hasData) && (
          <div>
            {isPending ? (
              <div className="flex gap-2">
                <Skeleton className="h-8 w-48 rounded-full" />
                <Skeleton className="h-8 w-56 rounded-full" />
                <Skeleton className="h-8 w-44 rounded-full" />
              </div>
            ) : hasData ? (
              <QuickInsights insights={data.insights} />
            ) : null}
          </div>
        )}

        {/* Pareto / ABC Analysis */}
        {(isPending || hasData) && (
          <DashboardSection title="ABC Analysis (Pareto)">
            {isPending ? (
              <ChartSkeleton />
            ) : hasData ? (
              <ParetoChart data={data.paretoItems} />
            ) : null}
          </DashboardSection>
        )}

        {/* Menu Engineering Matrix — Collapsible */}
        {(isPending || hasData) && (
          <MatrixSection isPending={isPending} hasData={hasData} data={data} />
        )}

        {/* Detailed Product Mix Table */}
        {(isPending || hasData) && (
          <DashboardSection title="Detailed Product Mix">
            {isPending ? (
              <DataTableSkeleton columns={10} rows={8} />
            ) : hasData ? (
              <ProductMixTable
                categories={data.tableCategories}
                totals={data.tableTotals}
              />
            ) : null}
          </DashboardSection>
        )}
      </div>
    </div>
  )
}

function MatrixSection({
  isPending,
  hasData,
  data,
}: {
  isPending: boolean
  hasData: boolean | ProductMixData | null
  data: ProductMixData | null
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 group cursor-pointer"
      >
        <h2 className="text-base font-semibold tracking-tight text-foreground/80">
          Menu Engineering Matrix
        </h2>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-0" : "-rotate-90"
          }`}
        />
        <span className="text-xs text-muted-foreground">
          {isOpen ? "Click to collapse" : "Click to expand"}
        </span>
      </button>
      {isOpen && (
        <>
          {isPending ? (
            <ChartSkeleton />
          ) : hasData && data ? (
            <MenuEngineeringMatrix
              items={data.matrixItems}
              thresholds={data.matrixThresholds}
            />
          ) : null}
        </>
      )}
    </section>
  )
}
