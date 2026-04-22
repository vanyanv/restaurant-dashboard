import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  KpiCardsSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { SectionErrorBoundary } from "@/components/analytics/section-error"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { InvoicesPeriodSelector } from "./invoices-period-selector"
import { SpendTrendSection } from "./sections/spend-trend-section"
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
import { resolvePeriod, type InvoiceFilters } from "./sections/data"

interface InvoicesShellProps {
  userId: string
  filters: InvoiceFilters
}

export function InvoicesShell({ userId, filters }: InvoicesShellProps) {
  const currentStore = filters.storeId ?? "all"
  const resolved = resolvePeriod(filters.period, filters.startDate, filters.endDate)

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

      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto flex max-w-350 flex-col gap-5 sm:gap-6">
          <InvoicesPeriodSelector
            period={filters.period}
            startDate={filters.startDate}
            endDate={filters.endDate}
            label={resolved.label}
          />

          <SectionErrorBoundary label="Spend trend unavailable">
            <Suspense
              fallback={<Skeleton className="h-80 w-full rounded-sm" />}
            >
              <SpendTrendSection filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Summary unavailable">
            <Suspense fallback={<KpiCardsSkeleton />}>
              <InvoiceSummaryKpisSection filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Invoice list unavailable">
            <Suspense
              fallback={
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-sm" />
                  <DataTableSkeleton columns={5} rows={8} />
                </div>
              }
            >
              <InvoicesListSection filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Charts unavailable">
            <Suspense
              fallback={
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                  <Skeleton className="h-80 w-full rounded-sm" />
                  <Skeleton className="h-80 w-full rounded-sm" />
                </div>
              }
            >
              <InvoiceSummaryChartsSection filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Top products unavailable">
            <Suspense
              fallback={<Skeleton className="h-28 w-full rounded-sm" />}
            >
              <TopProductsSection filters={filters} />
            </Suspense>
          </SectionErrorBoundary>

          <SectionErrorBoundary label="Price movers unavailable">
            <Suspense
              fallback={<DataTableSkeleton columns={5} rows={3} />}
            >
              <PriceMoversSection />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  )
}
