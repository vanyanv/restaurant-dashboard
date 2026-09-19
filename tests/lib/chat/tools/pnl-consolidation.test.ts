/*
 * getPnlSummary's combined row matrix, across stores that do not have the
 * same lines.
 *
 * The chat tool carried its own copy of the consolidation, and that copy
 * summed the stores' matrices by ROW INDEX. Custom fixed expenses are per
 * store and appended in each store's own order, so index N is not the same
 * line across stores: Hollywood's pest control could be added to Glendale's
 * linen bill and shipped to the model under whichever label the first store
 * happened to use. A store with fewer rows than the first simply dropped its
 * tail.
 *
 * `consolidateRows` in @/lib/pnl merges by code and is what the P&L page
 * itself uses. One matrix, one merge.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async () => ["holly", "gln"]),
}))

import { getPnlSummary } from "@/lib/chat/tools/pnl"
import type { PnLRow } from "@/lib/pnl"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const STORES = [
  {
    id: "gln",
    name: "Glendale",
    fixedMonthlyLabor: null,
    fixedMonthlyRent: 6_000,
    fixedMonthlyTowels: null,
    fixedMonthlyCleaning: null,
    uberCommissionRate: 0.21,
    doordashCommissionRate: 0.25,
    targetCogsPct: 30,
  },
  {
    id: "holly",
    name: "Hollywood",
    fixedMonthlyLabor: null,
    fixedMonthlyRent: 9_000,
    fixedMonthlyTowels: null,
    fixedMonthlyCleaning: null,
    uberCommissionRate: 0.21,
    doordashCommissionRate: 0.25,
    targetCogsPct: 30,
  },
]

/**
 * Glendale carries one custom expense, Hollywood two — and Hollywood's first
 * one is a different thing from Glendale's. Index-wise, Glendale's $500 pest
 * control was added to Hollywood's $1,200 linen line.
 */
const FIXED_EXPENSES = [
  { id: "fx_gln_pest", storeId: "gln", label: "Pest control", amount: 500, frequency: "MONTHLY" },
  { id: "fx_hol_linen", storeId: "holly", label: "Linen", amount: 1_200, frequency: "MONTHLY" },
  { id: "fx_hol_music", storeId: "holly", label: "Music licence", amount: 90, frequency: "MONTHLY" },
]

function summary(storeId: string, gross: number) {
  return {
    storeId,
    date: new Date(Date.UTC(2026, 7, 10)),
    platform: "css-pos",
    paymentMethod: "CARD",
    fpGrossSales: gross,
    tpGrossSales: null,
    fpTaxCollected: null,
    tpTaxCollected: null,
    fpDiscounts: null,
    tpDiscounts: null,
    fpServiceCharges: null,
    tpServiceCharges: null,
    fpOrderCount: 100,
    tpOrderCount: null,
  }
}

const ctx: ChatToolContext = {
  ownerId: "u1",
  accountId: "acct-A",
  prisma: {
    store: { findMany: vi.fn(async () => STORES) },
    otterDailySummary: {
      findMany: vi.fn(async () => [summary("gln", 20_000), summary("holly", 30_000)]),
    },
    dailyCogsItem: { findMany: vi.fn(async () => []) },
    harriDailyLabor: { findMany: vi.fn(async () => []) },
    storeFixedExpense: { findMany: vi.fn(async () => FIXED_EXPENSES) },
  } as unknown as ChatToolContext["prisma"],
}

const run = () =>
  getPnlSummary.execute(
    {
      dateRange: { from: "2026-08-01", to: "2026-08-31" },
      granularity: "monthly",
      comparePrevious: false,
    },
    ctx,
  )

const rowFor = (rows: PnLRow[], code: string) => rows.find((r) => r.code === code)

/** A monthly amount lands on August's 31 days of an average 30.4375-day month. */
const AUGUST = 31 / 30.4375

describe("getPnlSummary — combining stores that do not have the same lines", () => {
  it("keeps every store's custom expense as its own line, under its own label", async () => {
    const { rows } = await run()

    expect(rowFor(rows, "FX_fx_gln_pest")?.label).toBe("Pest control")
    expect(rowFor(rows, "FX_fx_hol_linen")?.label).toBe("Linen")
    expect(rowFor(rows, "FX_fx_hol_music")?.label).toBe("Music licence")
  })

  it("does not add one store's expense into another's line", async () => {
    const { rows } = await run()

    // Index-wise these two collided. Each is a monthly amount prorated over
    // August's 31 days, negative as a cost.
    expect(rowFor(rows, "FX_fx_gln_pest")?.values[0]).toBeCloseTo(-500 * AUGUST, 2)
    expect(rowFor(rows, "FX_fx_hol_linen")?.values[0]).toBeCloseTo(-1_200 * AUGUST, 2)
    expect(rowFor(rows, "FX_fx_hol_music")?.values[0]).toBeCloseTo(-90 * AUGUST, 2)
  })

  it("still sums the lines both stores DO share", async () => {
    const { rows } = await run()
    expect(rowFor(rows, "TOTAL_SALES")?.values[0]).toBeCloseTo(50_000, 2)
    expect(rowFor(rows, "7200")?.values[0]).toBeCloseTo(-15_000 * AUGUST, 2)
  })
})
