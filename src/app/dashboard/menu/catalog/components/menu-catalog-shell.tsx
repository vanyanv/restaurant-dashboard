import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { CatalogRowsSection } from "./sections/catalog-rows-section"

export function MenuCatalogShell() {
  return (
    <div className="editorial-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      <EditorialTopbar section="§ 12" title="Menu" />

      <SectionErrorBoundary label="Menu catalog unavailable">
        <Suspense fallback={<MenuCatalogSkeleton />}>
          <CatalogRowsSection />
        </Suspense>
      </SectionErrorBoundary>
    </div>
  )
}

function MenuCatalogSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Category + attention pill strip */}
      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-16 rounded-sm" />
          <Skeleton className="h-7 w-20 rounded-sm" />
          <Skeleton className="h-7 w-20 rounded-sm" />
          <Skeleton className="h-7 w-24 rounded-sm" />
          <Skeleton className="h-7 w-20 rounded-sm" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-sm" />
          <Skeleton className="h-6 w-28 rounded-sm" />
          <Skeleton className="h-6 w-28 rounded-sm" />
          <Skeleton className="h-6 w-24 rounded-sm" />
        </div>
      </div>

      {/* Search + table */}
      <div className="flex-1 overflow-y-auto bg-[var(--paper)] px-8 py-8">
        <div className="mb-6 flex items-center gap-2 border-b border-[var(--hairline-bold)] pb-3">
          <Skeleton className="h-4 w-40 rounded-sm" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  )
}
