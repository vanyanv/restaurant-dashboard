// `loadCountEntry` — the first link of the closed loop.
//
// It hard-coded `estimate: null` on every row it handed the entry form, so the
// entry form carried null down to `saveStockCountLine`, so
// `StockCountLine.estimatedQtyAtCount` was null on every line ever written, so
// `applyCalibrationUpdatesForCount` early-returned on close and
// `IngredientModelState` stayed at 0 rows — which was then read back as proof
// that no expectation could be produced.
//
// These tests pin the three things the fix has to get right:
//   1. An expectation IS recorded when the ingredient has a CLOSED count
//      behind it to be measured from, anchored to `StockCount.startedAt`.
//   2. It is NOT recorded when there is no anchor. `runningOnHandFromContext`
//      re-bases on the epoch in that case and returns every delivery ever
//      recorded minus every sale ever modelled, which is not an expectation.
//   3. The account boundary survives: the count row, the catalogue and the
//      anchor probe are all filtered by the CALLER's accountId, never the
//      fetched row's.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    ingredientModelState: { count: vi.fn() },
    store: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
} from "@/lib/inventory/store-inventory-context"
import { getCountSessionSectionPromises } from "@/lib/counter/adapters/stock-counts"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STARTED_AT = new Date("2026-09-18T21:04:00.000Z")
const CLOSED_AT = new Date("2026-09-11T21:00:00.000Z")

/**
 * Two different `stockCount.findFirst` calls happen in `loadCountEntry`: the
 * count row itself, and the one-row probe for "has this store ever closed a
 * count before this session opened". They are told apart by `where.status`.
 */
function mockCountRow(opts: { anchored: boolean }) {
  asMock(prisma.stockCount.findFirst).mockImplementation(
    async (args: { where: Record<string, unknown> }) => {
      if (args.where.status === "COMPLETED") {
        return opts.anchored ? { id: "closed-1" } : null
      }
      return {
        id: "count_ours",
        status: "IN_PROGRESS",
        storeId: "store_a",
        startedAt: STARTED_AT,
      }
    },
  )
}

function mockCatalogue() {
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([
    {
      id: "ci_beef",
      name: "beef",
      category: "Protein",
      recipeUnit: "oz",
      caseUnit: "CS",
      recipeUnitsPerCase: 160,
      innerPackUnit: null,
      innerPacksPerCase: null,
    },
  ])
  asMock(prisma.stockCountLine.findMany).mockResolvedValue([])
}

async function entrySection() {
  const section = await getCountSessionSectionPromises({
    countId: "count_ours",
    accountId: "acct_ours",
  }).entry
  if (section.status !== "ready") {
    throw new Error(`entry section was ${section.status}, expected ready`)
  }
  return section.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCatalogue()
  asMock(loadStoreInventoryContext).mockResolvedValue({ storeId: "store_a" })
})

describe("loadCountEntry · the expectation", () => {
  it("records an expected quantity when the ingredient has a closed count behind it", async () => {
    mockCountRow({ anchored: true })
    asMock(runningOnHandFromContext).mockReturnValue({
      ingredientId: "ci_beef",
      baseQty: 180,
      baseAt: CLOSED_AT,
      deliveriesQty: 320,
      depletionQty: 287.5,
      adjustmentsQty: 0,
      onHand: 212.5,
      partial: false,
    })

    const entry = await entrySection()

    // THE defect: this was `null` for every row, forever.
    expect(entry.rows[0].estimate).toBe(212.5)
  })

  it("anchors the whole session to StockCount.startedAt, not to now", async () => {
    mockCountRow({ anchored: true })
    asMock(runningOnHandFromContext).mockReturnValue({
      baseAt: CLOSED_AT,
      onHand: 4,
    })

    await entrySection()

    expect(asMock(loadStoreInventoryContext)).toHaveBeenCalledTimes(1)
    expect(asMock(loadStoreInventoryContext).mock.calls[0][0]).toMatchObject({
      storeId: "store_a",
      accountId: "acct_ours",
      asOf: STARTED_AT,
    })
  })

  it("records nothing, and does not even prefetch, when the store has never closed a count", async () => {
    mockCountRow({ anchored: false })

    const entry = await entrySection()

    expect(entry.rows[0].estimate).toBeNull()
    // The six-query prefetch is skipped entirely on the cheap indexed probe.
    expect(asMock(loadStoreInventoryContext)).not.toHaveBeenCalled()
    expect(asMock(runningOnHandFromContext)).not.toHaveBeenCalled()
  })

  it("records nothing for an ingredient with no anchor of its own", async () => {
    // The store has closed a count, but this ingredient was not on it, so the
    // walk would re-base on the epoch for this row alone.
    mockCountRow({ anchored: true })
    asMock(runningOnHandFromContext).mockReturnValue({
      baseQty: 0,
      baseAt: null,
      deliveriesQty: 12_400,
      depletionQty: 190,
      adjustmentsQty: 0,
      onHand: 12_210, // every delivery ever: not an expectation
      partial: true,
    })

    const entry = await entrySection()

    expect(entry.rows[0].estimate).toBeNull()
  })

  it("keeps the entry form when the expectation prefetch fails", async () => {
    mockCountRow({ anchored: true })
    asMock(loadStoreInventoryContext).mockRejectedValue(new Error("pool timeout"))

    const entry = await entrySection()

    expect(entry.rows).toHaveLength(1)
    expect(entry.rows[0].estimate).toBeNull()
  })
})

describe("loadCountEntry · copy", () => {
  it("does not blame the unfinished count when there is no anchor", async () => {
    mockCountRow({ anchored: false })
    const entry = await entrySection()

    expect(entry.note).toContain("Nothing here records an expected quantity")
    expect(entry.note).toContain("finishing this count will not")
    // The old copy: "Closing the count is what makes it count: the on-hand
    // model calibrates on completed counts" — which reads as "finish this one
    // and you get a variance". You do not; the NEXT one does.
    expect(entry.note).not.toContain("Closing the count is what makes it count")
  })

  it("says what the expectation is anchored to when there is one", async () => {
    mockCountRow({ anchored: true })
    asMock(runningOnHandFromContext).mockReturnValue({ baseAt: CLOSED_AT, onHand: 9 })

    const entry = await entrySection()

    expect(entry.note).toContain("expected on the shelf")
    expect(entry.note).toContain("last closed count on this store")
  })
})

describe("loadCountEntry · tenancy", () => {
  it("scopes the count row, the catalogue and the anchor probe to the caller's account", async () => {
    mockCountRow({ anchored: true })
    asMock(runningOnHandFromContext).mockReturnValue({ baseAt: CLOSED_AT, onHand: 1 })

    await entrySection()

    const calls = asMock(prisma.stockCount.findFirst).mock.calls
    const countRowWhere = calls.find((c) => c[0].where.status !== "COMPLETED")![0].where
    const anchorWhere = calls.find((c) => c[0].where.status === "COMPLETED")![0].where

    expect(countRowWhere).toMatchObject({
      id: "count_ours",
      store: { accountId: "acct_ours" },
    })
    // StockCount has no accountId column — the boundary is store.accountId,
    // and the probe must carry it too rather than trusting the storeId it was
    // handed.
    expect(anchorWhere).toMatchObject({
      storeId: "store_a",
      status: "COMPLETED",
      store: { accountId: "acct_ours" },
    })
    expect(asMock(prisma.canonicalIngredient.findMany).mock.calls[0][0].where).toMatchObject({
      accountId: "acct_ours",
    })
    // The old findUnique-by-id-alone path must stay gone.
    expect(asMock(prisma.stockCount.findUnique)).not.toHaveBeenCalled()
  })

  it("yields no entry section for a foreign countId", async () => {
    asMock(prisma.stockCount.findFirst).mockResolvedValue(null)
    const section = await getCountSessionSectionPromises({
      countId: "count_theirs",
      accountId: "acct_ours",
    }).entry
    expect(section.status).toBe("empty")
    expect(asMock(loadStoreInventoryContext)).not.toHaveBeenCalled()
  })
})
