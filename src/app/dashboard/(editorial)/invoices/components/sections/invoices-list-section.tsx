import { InvoicesListClient } from "../invoices-list-client"
import { InvoicesFilterBar } from "../invoices-filter-bar"
import { fetchInvoiceList, fetchSummary, type InvoiceFilters } from "./data"

export async function InvoicesListSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const [list, summary] = await Promise.all([
    fetchInvoiceList(
      filters.storeId,
      filters.status,
      filters.vendor,
      filters.startDate,
      filters.endDate,
      filters.page
    ),
    fetchSummary(filters.storeId, filters.startDate, filters.endDate),
  ])

  return (
    <div className="space-y-3">
      <InvoicesFilterBar
        vendor={filters.vendor ?? ""}
        status={filters.status ?? "all"}
        total={list.total}
        needsReview={summary.pendingReviewCount}
      />
      <InvoicesListClient
        invoices={list.invoices}
        total={list.total}
        page={list.page}
        totalPages={list.totalPages}
      />
    </div>
  )
}
