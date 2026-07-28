import { Suspense } from "react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "@/app/dashboard/components/editorial-topbar"
import { KpiStripSection } from "./sections/kpi-strip-section"
import { ProfitMatrixSection } from "./sections/profit-matrix-section"
import { ItemTableSection } from "./sections/item-table-section"
import { CoverageSection } from "./sections/coverage-section"

const DAY_PRESETS = [7, 30, 90] as const

export function MenuProfitShell({
  storeId,
  days,
}: {
  storeId?: string
  days: number
}) {
  const hrefFor = (d: number) => {
    const params = new URLSearchParams()
    if (storeId) params.set("storeId", storeId)
    params.set("days", String(d))
    return `/dashboard/menu-profit?${params.toString()}`
  }

  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar section="§ 14" title="Menu Profit">
        <nav
          aria-label="Lookback window"
          className="flex items-center gap-1"
        >
          {DAY_PRESETS.map((d) => (
            <Link
              key={d}
              href={hrefFor(d)}
              aria-current={days === d ? "true" : undefined}
              className={`toolbar-btn ${days === d ? "active" : ""}`}
            >
              {d}d
            </Link>
          ))}
        </nav>
      </EditorialTopbar>

      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-col gap-6">
          <SectionErrorBoundary label="Menu KPIs unavailable">
            <Suspense fallback={<Skeleton className="h-28 w-full rounded-sm" />}>
              <KpiStripSection storeId={storeId} days={days} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Profit matrix unavailable">
            <Suspense fallback={<Skeleton className="h-96 w-full rounded-sm" />}>
              <ProfitMatrixSection storeId={storeId} days={days} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Item table unavailable">
            <Suspense fallback={<Skeleton className="h-96 w-full rounded-sm" />}>
              <ItemTableSection storeId={storeId} days={days} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Coverage unavailable">
            <Suspense fallback={<Skeleton className="h-24 w-full rounded-sm" />}>
              <CoverageSection storeId={storeId} days={days} />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  )
}
