import { SectionHead } from "../section-head"
import { PnLStoreComparison } from "@/components/pnl/pnl-store-comparison"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchAllStoresPnL } from "./data"

export async function PnLStoreComparisonSection({
  range,
}: {
  range: DashboardRange
}) {
  const result = await fetchAllStoresPnL(range)

  if ("error" in result) {
    return (
      <div className="dock-in dock-in-3">
        <SectionHead label="Stores side by side" />
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {result.error}
        </div>
      </div>
    )
  }

  if (result.perStore.length === 0) {
    return null
  }

  const cols = result.perStore.map((s) => ({
    storeId: s.storeId,
    storeName: s.storeName,
    grossSales: s.grossSales,
    cogsValue: s.cogsValue,
    laborValue: s.laborValue,
    rentValue: s.rentValue + (s.fixedCosts - s.laborValue - s.rentValue), // rent + cleaning + towels
    bottomLine: s.bottomLine,
    marginPct: s.marginPct,
    fixedCostsConfigured: s.fixedCostsConfigured,
  }))

  const total = {
    storeId: null,
    storeName: "Total",
    grossSales: result.combined.grossSales,
    cogsValue: result.combined.cogsValue,
    laborValue: result.combined.laborValue,
    rentValue:
      result.combined.rentValue +
      (result.combined.fixedCosts -
        result.combined.laborValue -
        result.combined.rentValue),
    bottomLine: result.combined.bottomLine,
    marginPct: result.combined.marginPct,
    fixedCostsConfigured: true,
  }

  return (
    <div className="dock-in dock-in-3">
      <SectionHead label="Stores side by side" />
      <PnLStoreComparison stores={cols} total={total} />
    </div>
  )
}
