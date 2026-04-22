import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { CogsDateControls } from "../components/cogs-date-controls"
import { TargetChip } from "../components/target-chip"
import { DataQualityStripSection } from "../components/sections/data-quality-strip-section"
import { CogsKpiStripSection } from "../components/sections/cogs-kpi-strip-section"
import { CogsTrendSection } from "../components/sections/cogs-trend-section"
import { CostByCategorySection } from "../components/sections/cost-by-category-section"
import { WorstMarginItemsSection } from "../components/sections/worst-margin-items-section"
import { TopCostDriverIngredientsSection } from "../components/sections/top-cost-driver-ingredients-section"
import type { CogsFilters } from "../components/sections/data"

interface CogsShellProps {
  storeId: string
  storeName: string
  targetCogsPct: number | null
  filters: CogsFilters
  activeDays: number | null
}

export function CogsShell({
  storeId,
  storeName,
  targetCogsPct,
  filters,
  activeDays,
}: CogsShellProps) {
  const basePath = `/dashboard/cogs/${storeId}`

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 13"
        title={`COGS · ${storeName}`}
        stamps={
          <TargetChip storeId={storeId} initialValue={targetCogsPct} />
        }
      >
        <CogsDateControls
          basePath={basePath}
          startDate={filters.startDate}
          endDate={filters.endDate}
          granularity={filters.granularity}
          activeDays={activeDays}
        />
      </EditorialTopbar>

      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="cogs-page flex flex-col gap-6">
          <SectionErrorBoundary label="Data-quality unavailable">
            <Suspense fallback={null}>
              <DataQualityStripSection storeId={storeId} filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="KPIs unavailable">
            <Suspense fallback={<Skeleton className="h-40 w-full rounded-sm" />}>
              <CogsKpiStripSection storeId={storeId} filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Trend unavailable">
            <Suspense fallback={<Skeleton className="h-72 w-full rounded-sm" />}>
              <CogsTrendSection storeId={storeId} filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionErrorBoundary label="Category breakdown unavailable">
              <Suspense
                fallback={<Skeleton className="h-80 w-full rounded-sm" />}
              >
                <CostByCategorySection storeId={storeId} filters={filters} />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary label="Worst-margin items unavailable">
              <Suspense
                fallback={<Skeleton className="h-80 w-full rounded-sm" />}
              >
                <WorstMarginItemsSection storeId={storeId} filters={filters} />
              </Suspense>
            </SectionErrorBoundary>
          </div>

          <SectionErrorBoundary label="Top cost-driver ingredients unavailable">
            <Suspense fallback={<Skeleton className="h-80 w-full rounded-sm" />}>
              <TopCostDriverIngredientsSection
                storeId={storeId}
                filters={filters}
              />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  )
}
