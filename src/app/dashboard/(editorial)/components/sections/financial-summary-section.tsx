import { prisma } from "@/lib/prisma"
import { OverviewLedger } from "../overview-ledger"
import { SectionHead } from "../section-head"
import { rangeDateLabel } from "@/lib/dashboard/range-label"
import type { DashboardRange } from "@/lib/dashboard-utils"
import type { DashboardPromise } from "./data"

export async function FinancialSummarySection({
  dashboardPromise,
  range,
}: {
  dashboardPromise: DashboardPromise
  range: DashboardRange
}) {
  const data = await dashboardPromise
  const hasData = data && data.rows.length > 0

  // Stores that haven't opened yet render as a single "opening soon" line
  // instead of a full ledger row of zeros — an unopened store is not a dead
  // store. Row storeIds are already tenant-scoped by the analytics action.
  let preOpenStoreIds: string[] = []
  if (hasData) {
    const storeIds = data.rows
      .map((r) => r.storeId)
      .filter((id) => id !== "total")
    const preOpen = await prisma.store.findMany({
      where: { id: { in: storeIds }, lifecycleStage: "pre_open" },
      select: { id: true },
    })
    preOpenStoreIds = preOpen.map((s) => s.id)
  }

  return (
    <div className="dock-in dock-in-8">
      <SectionHead label="Per-store ledger" />
      {hasData ? (
        <OverviewLedger
          rows={data.rows}
          totals={data.totals}
          storeChannelRows={data.storeChannelRows}
          preOpenStoreIds={preOpenStoreIds}
          stamp={rangeDateLabel(range)}
        />
      ) : (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="editorial-section-label mb-3">empty ledger</div>
          <p className="font-display text-[24px] leading-tight max-w-md">
            No financial data yet.
          </p>
          <p className="mt-2 text-[13px] text-[var(--ink-muted)] max-w-sm">
            Run an Otter sync from the button above to pull last night&apos;s
            service into the ledger.
          </p>
        </div>
      )}
    </div>
  )
}
