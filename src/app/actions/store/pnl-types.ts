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

/** The rollup's cascade for one scope over one window. */
export type PnLPeriodLines = {
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

export type AllStoresPnLResult =
  | {
      storeCount: number
      combined: PnLPeriodLines
      perStore: Array<
        PnLPeriodLines & {
          storeId: string
          storeName: string
          channelMix: Array<{ channel: string; amount: number }>
          fixedCostsConfigured: boolean
          rows: PnLRow[]
          /**
           * THIS STORE's periods — the same shape as the account-wide
           * `perPeriod` below, over one store.
           *
           * A caller reading N windows for a SELECTED store must read them
           * here. `perPeriod` answers for the whole account whatever the
           * caller is scoped to, and `loadWeekStatements` read it regardless:
           * a single-store P&L printed a correct cascade above an eight-week
           * table summing every store, with nothing on the page to say the two
           * had different scopes.
           */
          perPeriod: PnLPeriodLines[]
        }
      >
      consolidatedRows: PnLRow[]
      /**
       * `combined`, but one entry PER PERIOD rather than for the whole range —
       * so, EVERY store on the account. For one store's periods read
       * `perStore[].perPeriod`.
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
      perPeriod: PnLPeriodLines[]
      periods: Period[]
    }
  | { error: string }
