import { getCogsTrend } from "@/lib/cogs"
import { prisma } from "@/lib/prisma"
import { CogsTrendChart } from "../cogs-trend-chart-slot"
import type { CogsFilters } from "./data"

function formatMoney(value: number): string {
  const abs = Math.abs(value)
  const text = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return value < 0 ? `-$${text}` : `$${text}`
}

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
  const target = store?.targetCogsPct ?? null
  const worstBucket = trend
    .filter((b) => b.revenueDollars > 0)
    .sort((a, b) => b.cogsPct - a.cogsPct)[0]

  if (!hasData) {
    return (
      <section className="inv-panel dock-in dock-in-3">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 03 Trend</span>
            <h2 className="inv-panel__title">Target drift</h2>
          </div>
        </div>
        <div className="cogs-empty-note">
          No COGS data for this period. Sync invoices and Otter sales.
        </div>
      </section>
    )
  }

  return (
    <section className="inv-panel dock-in dock-in-3">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 03 Trend</span>
          <h2 className="inv-panel__title">Target drift</h2>
        </div>
        {worstBucket ? (
          <div className="cogs-panel-stat">
            <span>worst bucket</span>
            <strong>{worstBucket.cogsPct.toFixed(1)}%</strong>
            <em>{formatMoney(worstBucket.cogsDollars)} COGS</em>
          </div>
        ) : null}
      </div>
      <CogsTrendChart
        data={trend}
        targetCogsPct={target}
        granularity={filters.granularity}
      />
    </section>
  )
}
