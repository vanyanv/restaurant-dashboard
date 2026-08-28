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
      /**
       * `combined`, but one entry PER PERIOD rather than for the whole range.
       *
       * Built by indexing the very arrays `combined` sums — `computeStorePnL`
       * already produces every figure per period and the rollup reduces them.
       * So this re-derives nothing; it is the same numbers, unsummed.
       *
       * It exists so a caller wanting N statements over contiguous windows can
       * make ONE rollup call instead of N. `/dashboard/pnl` made ten (the
       * range, the comparison, and eight trailing weeks); the eight weeks are
       * now one call with eight explicit periods, read off here.
       */
      perPeriod: Array<{
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
      }>
      periods: Period[]
    }
  | { error: string }
