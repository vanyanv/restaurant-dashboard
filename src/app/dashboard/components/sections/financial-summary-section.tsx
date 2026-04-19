import { FinancialSummaryTable } from "../financial-summary-table"
import { SectionHead } from "../section-head"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchDashboard } from "./data"

export async function FinancialSummarySection({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  const hasData = data && data.rows.length > 0

  return (
    <div className="dock-in dock-in-5">
      <SectionHead label="Per-store ledger" />
      {hasData ? (
        <FinancialSummaryTable
          rows={data.rows}
          totals={data.totals}
          channelRows={data.channelRows}
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
