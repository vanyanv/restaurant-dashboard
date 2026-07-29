import { prisma } from "@/lib/prisma"
import { FinancialSummaryTable } from "../financial-summary-table"
import { SectionHead } from "../section-head"
import type { DashboardPromise } from "./data"

export async function FinancialSummarySection({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
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
    <div className="dock-in dock-in-5">
      <SectionHead label="Per-store ledger" />
      {hasData ? (
        <FinancialSummaryTable
          rows={data.rows}
          totals={data.totals}
          channelRows={data.channelRows}
          preOpenStoreIds={preOpenStoreIds}
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
