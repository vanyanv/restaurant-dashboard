import { SpendTrendClient } from "../spend-trend-client"
import { fetchSpendTimeline, type InvoiceFilters, resolvePeriod } from "./data"

export async function SpendTrendSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const resolved = resolvePeriod(filters.period, filters.startDate, filters.endDate)
  const timeline = await fetchSpendTimeline(
    filters.storeId,
    filters.startDate,
    filters.endDate,
    resolved.granularity
  )

  return (
    <SpendTrendClient
      buckets={timeline.buckets}
      granularity={timeline.granularity}
      total={timeline.total}
      invoiceCount={timeline.invoiceCount}
      avgPerBucket={timeline.avgPerBucket}
      peakBucket={timeline.peakBucket}
      periodLabel={resolved.label}
    />
  )
}
