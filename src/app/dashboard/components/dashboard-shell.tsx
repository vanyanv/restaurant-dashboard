import { Suspense } from "react"
import { ChartSkeleton } from "@/components/skeletons"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { DashboardTopbar } from "./dashboard-topbar"
import { SectionHead } from "./section-head"
import { RevenueTrendChartSlot } from "./revenue-trend-chart-slot"
import { FinancialSummaryTableSkeleton } from "./financial-summary-table"
import { HeroKpiSkeleton } from "./skeletons/hero-kpi-skeleton"
import { DayHighlightsSkeleton } from "./skeletons/day-highlights-skeleton"
import { InvoiceSnapshotSkeleton } from "./skeletons/invoice-snapshot-skeleton"
import { HeroKpisSection } from "./sections/hero-kpis-section"
import { DayHighlightsSection } from "./sections/day-highlights-section"
import { HourlyOrdersSection } from "./sections/hourly-orders-section"
import { FinancialSummarySection } from "./sections/financial-summary-section"
import { InvoiceSnapshotSection } from "./sections/invoice-snapshot-section"

interface DashboardShellProps {
  range: DashboardRange
  userRole: string
}

export function DashboardShell({ range, userRole }: DashboardShellProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <DashboardTopbar userRole={userRole} range={range} />

      <section className="editorial-masthead-slim dock-in dock-in-1">
        <div className="flex items-baseline justify-between gap-4 mb-5">
          <div className="editorial-section-label">
            The daily report · Vol. 04
          </div>
        </div>
        <Suspense fallback={<HeroKpiSkeleton />}>
          <HeroKpisSection range={range} />
        </Suspense>
      </section>

      <div className="px-6 py-8 space-y-8">
        <Suspense fallback={<DayHighlightsSkeleton />}>
          <DayHighlightsSection range={range} />
        </Suspense>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 dock-in dock-in-4">
          <div className="min-w-0 lg:col-span-3">
            <SectionHead label="Revenue trend" />
            <RevenueTrendChartSlot />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <SectionHead label="Service by the hour" />
            <Suspense
              fallback={
                <ChartSkeleton height="h-[280px] md:h-[340px] lg:h-[380px]" />
              }
            >
              <HourlyOrdersSection range={range} />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<FinancialSummaryTableSkeleton />}>
          <FinancialSummarySection range={range} />
        </Suspense>

        <Suspense fallback={<InvoiceSnapshotSkeleton />}>
          <InvoiceSnapshotSection />
        </Suspense>
      </div>
    </div>
  )
}
