import type { Period, PnLRow } from "@/lib/pnl"
import type { UnmappedMenuItem } from "@/types/cogs"

export type PnLMover = {
  itemName: string
  category: string
  current: number
  prior: number
  delta: number
  pctDelta: number
  qtyCurrent: number
  qtyPrior: number
  qtyDelta: number
}

export type StorePnLResult =
  | {
      storeName: string
      periods: Period[]
      rows: PnLRow[]
      fixedLaborConfigured: boolean
      fixedRentConfigured: boolean
      kpis: {
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
      }
      channelMix: Array<{ channel: string; amount: number }>
      trend: {
        totalSales: number[]
        bottomLine: number[]
      }
      cogs: {
        totalCogs: number
        grossProfit: number
        grossMarginPct: number
        unmappedItems: UnmappedMenuItem[]
        missingCostItems: UnmappedMenuItem[]
        refillFailedPeriodIndexes: number[]
      }
      movers: PnLMover[]
    }
  | { error: string }

export type AllStoresPnLResult =
  | {
      storeCount: number
      combined: {
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
        cogsValue: number
        cogsPct: number
        laborValue: number
        laborPct: number
        rentValue: number
        rentPct: number
      }
      perStore: Array<{
        storeId: string
        storeName: string
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
        cogsValue: number
        cogsPct: number
        laborValue: number
        laborPct: number
        rentValue: number
        rentPct: number
        channelMix: Array<{ channel: string; amount: number }>
        fixedCostsConfigured: boolean
        rows: PnLRow[]
      }>
      consolidatedRows: PnLRow[]
      periods: Period[]
    }
  | { error: string }
