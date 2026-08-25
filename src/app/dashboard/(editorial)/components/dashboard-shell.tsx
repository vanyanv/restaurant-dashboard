import { Suspense } from "react"
import { ChartSkeleton } from "@/components/skeletons"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { hasOwnerAccess } from "@/lib/auth"
import { Role } from "@/generated/prisma/client"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { DashboardTopbar } from "./dashboard-topbar"
import { GreetingMasthead, FolioDot } from "./greeting-masthead"
import { SectionHead } from "./section-head"
import { OverviewLedgerSkeleton } from "./skeletons/ledger-skeleton"
import { HeroKpiSkeleton } from "./skeletons/hero-kpi-skeleton"
import { InvoiceSnapshotSkeleton } from "./skeletons/invoice-snapshot-skeleton"
import { PnLSummarySkeleton } from "./skeletons/pnl-summary-skeleton"
import { HeroKpisSection } from "./sections/hero-kpis-section"
import { LedeSection } from "./sections/lede-section"
import { DispatchesStrip } from "./sections/dispatches-strip"
import { ModelCallSection } from "./sections/model-call-section"
import { NeedsYouSection } from "./sections/needs-you-section"
import { StillMovingSection } from "./sections/still-moving-section"
import { PnLSummarySection } from "./sections/pnl-summary-section"
import { RevenueTrendSection } from "./sections/revenue-trend-section"
import { SplhSection } from "./sections/splh-section"
import { FinancialSummarySection } from "./sections/financial-summary-section"
import { InvoiceSnapshotSection } from "./sections/invoice-snapshot-section"
import { RatingsSection } from "./sections/ratings-section"
import { buildDashboardData, buildPnLBaseline, buildPnLSummary } from "./sections/data"

interface DashboardShellProps {
  range: DashboardRange
  userRole: string
  userName: string | null | undefined
}

export function DashboardShell({ range, userRole, userName }: DashboardShellProps) {
  const { dashboard: dashboardPromise, otter: otterPromise } =
    buildDashboardData(range)
  const isOwner = hasOwnerAccess(userRole as Role)
  const pnlPromise = isOwner ? buildPnLSummary(range) : null
  const pnlBaseline = isOwner ? buildPnLBaseline(range) : null

  return (
    <div className="flex flex-col min-h-screen">
      <DashboardTopbar
        userRole={userRole}
        range={range}
        dashboardPromise={dashboardPromise}
      />

      <GreetingMasthead
        userName={userName}
        now={new Date()}
        folio={
          <>
            <span>The daily report</span>
            <FolioDot />
            <span>Vol. 04 · No. {issueNumber(new Date())}</span>
            <FolioDot />
            {/* Dated by the RANGE, not by the clock: a folio saying Thursday
                over Wednesday's figures reads as a bug, not as an edition. */}
            <span suppressHydrationWarning>{issueDate(rangeEndDate(range))}</span>
          </>
        }
        dispatch={
          <Suspense fallback={null}>
            <DispatchesStrip otterPromise={otterPromise} />
          </Suspense>
        }
      >
        <Suspense fallback={null}>
          <LedeSection
            range={range}
            pnlPromise={pnlPromise}
            baseline={pnlBaseline}
          />
        </Suspense>
        <Suspense fallback={<HeroKpiSkeleton />}>
          <HeroKpisSection
            range={range}
            otterPromise={otterPromise}
            pnlPromise={pnlPromise}
            baseline={pnlBaseline}
          />
        </Suspense>
      </GreetingMasthead>

      <div className="px-6 py-8 space-y-8">
        {/* Profit sits directly under the masthead: it is the figure the owner
            opens the page for, and the rail above it is the evidence. */}
        {pnlPromise && (
          <Suspense fallback={<PnLSummarySkeleton />}>
            <PnLSummarySection
              pnlPromise={pnlPromise}
              baseline={pnlBaseline}
              range={range}
            />
          </Suspense>
        )}

        <Suspense fallback={null}>
          <StillMovingSection
            range={range}
            otterPromise={otterPromise}
            pnlPromise={pnlPromise}
          />
        </Suspense>

        {/* Exception-first: what needs a human sits above the evidence for it.
            Own boundary — a dead alert table must not take the report down. */}
        <SectionErrorBoundary label="Attention queue unavailable">
          <Suspense fallback={null}>
            <NeedsYouSection />
          </Suspense>
        </SectionErrorBoundary>

        {/* The forecast sits between the queue and the charts: it explains the
            gap the queue just reported, and the trend below is its history. */}
        <SectionErrorBoundary label="Forecast unavailable">
          <Suspense fallback={null}>
            <ModelCallSection range={range} otterPromise={otterPromise} />
          </Suspense>
        </SectionErrorBoundary>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 dock-in dock-in-7">
          <div className="min-w-0 lg:col-span-3">
            <Suspense fallback={<ChartSkeleton height="h-[248px]" />}>
              <RevenueTrendSection />
            </Suspense>
          </div>
          {/* Labour productivity sits beside revenue because the pair is the
              question: the trend says what came in, this says whether the
              hours behind it were earned. Order volume by hour moved to
              /dashboard/analytics — it answers "when is demand", which this
              chart deliberately does not. */}
          <div className="min-w-0 lg:col-span-2">
            <Suspense fallback={<ChartSkeleton height="h-[248px]" />}>
              <SplhSection />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<OverviewLedgerSkeleton />}>
          <FinancialSummarySection
            dashboardPromise={dashboardPromise}
            range={range}
          />
        </Suspense>

        {/* Invoices and reviews pair: both are 30-day context rather than
            today's news, and running them full width one after the other spent
            a screen of scroll on the least urgent content on the page. */}
        <div className="ov-pair dock-in dock-in-9">
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
    </div>
  )
}

/**
 * Folio number: day of the year, so the masthead carries an issue number that
 * advances once a day like a real broadsheet rather than a static "Vol. 04".
 * Computed in store-local time for the same reason the greeting is.
 */
function issueNumber(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
  const [y, m, d] = parts.split("-").map(Number)
  const start = Date.UTC(y, 0, 1)
  const today = Date.UTC(y, m - 1, d)
  return String(Math.floor((today - start) / 86_400_000) + 1)
}

/**
 * Last day of the selected range, in store-local terms. `days: -1` is
 * yesterday, `days: 1` is today, anything larger is a trailing window ending
 * today; a custom range ends on its own end date.
 */
function rangeEndDate(range: DashboardRange): Date {
  if (range.kind === "custom") return new Date(`${range.endDate}T12:00:00`)
  const d = new Date()
  if (range.days === -1) d.setDate(d.getDate() - 1)
  return d
}

function issueDate(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now)
}
