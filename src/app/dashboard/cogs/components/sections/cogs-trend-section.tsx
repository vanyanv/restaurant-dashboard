import { getCogsTrend } from "@/lib/cogs"
import { prisma } from "@/lib/prisma"
import { CogsTrendChart } from "../cogs-trend-chart"
import type { CogsFilters } from "./data"

export async function CogsTrendSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const [trend, store] = await Promise.all([
    getCogsTrend(
      storeId,
      filters.startDate,
      filters.endDate,
      filters.granularity
    ),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    }),
  ])

  const hasData = trend.some((b) => b.revenueDollars > 0)
  if (!hasData) {
    return (
      <section>
        <div className="font-label mb-2">§ 02 · Trend</div>
        <div className="font-mono text-xs italic text-(--ink-muted) py-10 text-center border-t border-(--hairline)">
          No COGS data for this period — sync invoices and Otter sales.
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="font-label mb-2">§ 02 · Trend</div>
      <CogsTrendChart
        data={trend}
        targetCogsPct={store?.targetCogsPct ?? null}
        granularity={filters.granularity}
      />
    </section>
  )
}
