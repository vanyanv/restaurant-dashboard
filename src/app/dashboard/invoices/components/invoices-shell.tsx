import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  KpiCardsSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { InvoiceSummaryKpisSection } from "./sections/summary-kpis-section"
import { InvoiceSummaryChartsSection } from "./sections/summary-charts-section"
import { TopProductsSection } from "./sections/top-products-section"
import { PriceMoversSection } from "./sections/price-movers-section"
import { InvoicesListSection } from "./sections/invoices-list-section"
import {
  InvoicesLastSyncText,
  InvoicesTopbarStoreFilter,
  InvoicesTopbarSyncButton,
} from "./sections/invoices-topbar-bits"
import type { InvoiceFilters } from "./sections/data"

interface InvoicesShellProps {
  userId: string
  filters: InvoiceFilters
}

export function InvoicesShell({ userId, filters }: InvoicesShellProps) {
  const currentStore = filters.storeId ?? "all"

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 02"
        title="Invoices"
        stamps={
          <Suspense fallback={<span className="opacity-40">syncing…</span>}>
            <InvoicesLastSyncText />
          </Suspense>
        }
      >
        <Suspense fallback={<Skeleton className="h-8 w-[160px] rounded-md" />}>
          <InvoicesTopbarStoreFilter userId={userId} current={currentStore} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-8 w-20 rounded-md" />}>
          <InvoicesTopbarSyncButton />
        </Suspense>
      </EditorialTopbar>

      <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-3">
        <SectionErrorBoundary label="Summary unavailable">
          <Suspense fallback={<KpiCardsSkeleton />}>
            <InvoiceSummaryKpisSection storeId={filters.storeId} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Charts unavailable">
          <Suspense
            fallback={
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                <Skeleton className="h-[320px] w-full rounded-md" />
                <Skeleton className="h-[320px] w-full rounded-md" />
              </div>
            }
          >
            <InvoiceSummaryChartsSection storeId={filters.storeId} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Top products unavailable">
          <Suspense
            fallback={<Skeleton className="h-28 w-full rounded-md" />}
          >
            <TopProductsSection storeId={filters.storeId} />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Price movers unavailable">
          <Suspense
            fallback={<DataTableSkeleton columns={5} rows={3} />}
          >
            <PriceMoversSection />
          </Suspense>
        </SectionErrorBoundary>

        <SectionErrorBoundary label="Invoice list unavailable">
          <Suspense
            fallback={<DataTableSkeleton columns={7} rows={6} />}
          >
            <InvoicesListSection filters={filters} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </div>
  )
}
