import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"
import { DateRangeUrlControls } from "@/components/analytics/date-range-url-controls"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { RevenueTrendsSection } from "./sections/revenue-trends-section"
import { PlatformAnalysisSection } from "./sections/platform-analysis-section"
import { TopMenuItemsSection } from "./sections/top-menu-items-section"
import { StoreComparisonSection } from "./sections/store-comparison-section"
import { AdditionalMetricsSection } from "./sections/additional-metrics-section"
import {
  AnalyticsDateStamp,
  AnalyticsLastSync,
  AnalyticsSyncButton,
} from "./sections/topbar-bits"

interface AnalyticsShellProps {
  range: DashboardRange
  userRole: string
}

export function AnalyticsShell({ range, userRole }: AnalyticsShellProps) {
  const stamps = (
    <>
      <Suspense fallback={<span className="opacity-40">…</span>}>
        <AnalyticsDateStamp range={range} />
      </Suspense>
      <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]" />
      <Suspense fallback={<span className="opacity-40">syncing…</span>}>
        <AnalyticsLastSync range={range} />
      </Suspense>
    </>
  )

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar section="§ 06" title="Analytics" stamps={stamps}>
        <DateRangeUrlControls range={range} basePath="/dashboard/analytics" />
        {userRole === "OWNER" && (
          <Suspense fallback={<Skeleton className="h-8 w-20 rounded-md" />}>
            <AnalyticsSyncButton range={range} />
          </Suspense>
        )}
      </EditorialTopbar>

      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <SectionErrorBoundary label="Revenue trends unavailable">
          <Suspense fallback={<HeatmapSkeleton />}>
            <RevenueTrendsSection range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Platform analysis unavailable">
          <Suspense
            fallback={
              <div className="space-y-4">
                <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
                <div className="grid gap-4 md:grid-cols-3">
                  <ChartSkeleton className="md:col-span-2" />
                  <PieChartSkeleton />
                </div>
              </div>
            }
          >
            <PlatformAnalysisSection range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Menu items unavailable">
          <Suspense fallback={<ChartSkeleton />}>
            <TopMenuItemsSection range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Store comparison unavailable">
          <Suspense fallback={<ChartSkeleton />}>
            <StoreComparisonSection range={range} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Additional metrics unavailable">
          <Suspense fallback={<AdditionalMetricsSkeleton />}>
            <AdditionalMetricsSection range={range} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  )
}
