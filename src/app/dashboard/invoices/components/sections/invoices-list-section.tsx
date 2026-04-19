import { InvoicesListClient } from "../invoices-list-client"
import { fetchInvoiceList, type InvoiceFilters } from "./data"

export async function InvoicesListSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const list = await fetchInvoiceList(
    filters.storeId,
    filters.status,
    filters.page
  )

  return (
    <InvoicesListClient
      invoices={list.invoices}
      total={list.total}
      page={list.page}
      totalPages={list.totalPages}
      status={filters.status ?? "all"}
      storeId={filters.storeId ?? "all"}
    />
  )
}
