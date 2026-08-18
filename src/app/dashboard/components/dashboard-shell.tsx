import { Suspense } from "react"
import { ChartSkeleton } from "@/components/skeletons"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { hasOwnerAccess } from "@/lib/auth"
import { Role } from "@/generated/prisma/client"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { DashboardTopbar } from "./dashboard-topbar"
import { SectionHead } from "./section-head"
import { RevenueTrendChartSlot } from "./revenue-trend-chart-slot"
import { FinancialSummaryTableSkeleton } from "./financial-summary-table"
import { HeroKpiSkeleton } from "./skeletons/hero-kpi-skeleton"
import { InvoiceSnapshotSkeleton } from "./skeletons/invoice-snapshot-skeleton"
import { PnLSummarySkeleton } from "./skeletons/pnl-summary-skeleton"
import { HeroKpisSection } from "./sections/hero-kpis-section"
import { DispatchesStrip } from "./sections/dispatches-strip"
import { PnLSummarySection } from "./sections/pnl-summary-section"
import { SplhSection } from "./sections/splh-section"
import { FinancialSummarySection } from "./sections/financial-summary-section"
import { InvoiceSnapshotSection } from "./sections/invoice-snapshot-section"
import { RatingsSection } from "./sections/ratings-section"
import { buildDashboardData, buildPnLSummary } from "./sections/data"

interface DashboardShellProps {
  range: DashboardRange
  userRole: string
}

export function DashboardShell({ range, userRole }: DashboardShellProps) {
  const { dashboard: dashboardPromise, otter: otterPromise } =
    buildDashboardData(range)
  const isOwner = hasOwnerAccess(userRole as Role)
  const pnlPromise = isOwner ? buildPnLSummary(range) : null

  return (
    <div className="flex flex-col min-h-screen">
      <DashboardTopbar
        userRole={userRole}
        range={range}
        dashboardPromise={dashboardPromise}
      />

      <section className="editorial-masthead-slim dock-in dock-in-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-5">
          <div className="editorial-section-label">
            The daily report · Vol. 04
          </div>
          <Suspense fallback={null}>
            <DispatchesStrip otterPromise={otterPromise} />
          </Suspense>
        </div>
        <Suspense fallback={<HeroKpiSkeleton />}>
          <HeroKpisSection range={range} otterPromise={otterPromise} />
        </Suspense>
      </section>

      <div className="px-6 py-8 space-y-8">
        {pnlPromise && (
          <Suspense fallback={<PnLSummarySkeleton />}>
            <PnLSummarySection pnlPromise={pnlPromise} range={range} />
          </Suspense>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 dock-in dock-in-4">
          <div className="min-w-0 lg:col-span-3">
            <SectionHead label="Revenue trend" />
            <RevenueTrendChartSlot />
          </div>
          {/* Labour productivity sits beside revenue because the pair is the
              question: the trend says what came in, this says whether the
              hours behind it were earned. Order volume by hour moved to
              /dashboard/analytics — it answers "when is demand", which this
              chart deliberately does not. */}
          <div className="min-w-0 lg:col-span-2">
            <SectionHead label="Sales per labor hour" />
            <Suspense
              fallback={
                <ChartSkeleton height="h-[280px] md:h-[340px] lg:h-[380px]" />
              }
            >
              <SplhSection />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<FinancialSummaryTableSkeleton />}>
          <FinancialSummarySection dashboardPromise={dashboardPromise} />
        </Suspense>

        <Suspense fallback={<InvoiceSnapshotSkeleton />}>
          <InvoiceSnapshotSection />
        </Suspense>

        {/* Reviews explain the numbers above them, so they close the report
            rather than opening it. Own boundary: ratings are the newest read
            path here and must never take the daily report down. */}
        <SectionErrorBoundary label="Customer reviews unavailable">
          <Suspense fallback={null}>
            <RatingsSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  )
}
