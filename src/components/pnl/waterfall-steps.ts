import {
  TOTAL_SALES_CODE,
  UBER_COMMISSION_CODE,
  DOORDASH_COMMISSION_CODE,
  COGS_CODE,
  LABOR_CODE,
  RENT_CODE,
  CLEANING_CODE,
  TOWELS_CODE,
  AFTER_LABOR_RENT_CODE,
  CUSTOM_FIXED_CODE_PREFIX,
} from "@/lib/pnl"
import type { WaterfallStep } from "./pnl-waterfall"

/** Minimal row shape shared by getStorePnL rows and getAllStoresPnL
 *  consolidatedRows — everything the waterfall needs. */
export interface WaterfallSourceRow {
  code: string
  values: Array<number | null>
}

/**
 * Collapse a set of P&L rows (any period bucketing) into the six waterfall
 * steps: Gross → −Commissions → −COGS → −Labor → −Rent+Fixed → Bottom Line.
 * Used by both P&L pages for the current range AND the prior-window compare.
 */
export function buildWaterfallSteps(rows: WaterfallSourceRow[]): WaterfallStep[] {
  const sumRow = (code: string) => {
    const row = rows.find((r) => r.code === code)
    if (!row) return 0
    return row.values.reduce<number>((a, b) => a + (b ?? 0), 0)
  }
  const gross = sumRow(TOTAL_SALES_CODE)
  // Commissions stored as negatives — convert to positive amounts here.
  const commissions = Math.abs(
    sumRow(UBER_COMMISSION_CODE) + sumRow(DOORDASH_COMMISSION_CODE)
  )
  const cogs = sumRow(COGS_CODE)
  const labor = sumRow(LABOR_CODE)
  const rent = sumRow(RENT_CODE)
  const cleaning = sumRow(CLEANING_CODE)
  const towels = sumRow(TOWELS_CODE)
  // Owner-managed custom fixed expenses (code FX_*) — stored negative, same
  // sign convention as rent/cleaning/towels.
  const customFixed = rows
    .filter((r) => r.code.startsWith(CUSTOM_FIXED_CODE_PREFIX))
    .reduce((a, r) => a + r.values.reduce<number>((x, y) => x + (y ?? 0), 0), 0)
  const bottom = sumRow(AFTER_LABOR_RENT_CODE)

  return [
    { kind: "total", label: "Gross Sales", value: gross },
    { kind: "subtract", label: "3P Commissions", value: commissions },
    { kind: "subtract", label: "COGS", value: cogs },
    { kind: "subtract", label: "Labor", value: labor },
    {
      kind: "subtract",
      label: "Rent + Fixed",
      value: rent + cleaning + towels + customFixed,
    },
    { kind: "total", label: "Bottom Line", value: bottom },
  ]
}
