// stock-counts adapter — two account-boundary holes.
//
// 1. `loadCountEntry` looked up the count row by id alone (`findUnique`),
//    then trusted the row's OWN `store.accountId` as the boundary. Any
//    countId from any account produced a valid entry section; the caller's
//    accountId was never checked against it.
// 2. The stock-counts list loader called `ingredientModelState.count()` with
//    no `where` at all, so the "model state rows" figure on the progress
//    section counted every account's rows, not just the signed-in account's
//    stores.

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

import { prisma } from "@/lib/prisma"
import {
  getCountSessionSectionPromises,
  getStockCountsSectionPromises,
} from "@/lib/counter/adapters/stock-counts"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe("count session tenancy", () => {
  beforeEach(() => vi.clearAllMocks())

  it("a foreign countId yields no entry section", async () => {
    // findFirst (the fixed query) returns null when the account doesn't match
    asMock(prisma.stockCount.findFirst).mockResolvedValue(null)
    const sections = getCountSessionSectionPromises({
      countId: "count_theirs",
      accountId: "acct_ours",
    })
    const entry = await sections.entry
    expect(entry.status).toBe("empty")
    // The old findUnique-by-id-alone path must be gone entirely:
    expect(asMock(prisma.stockCount.findUnique)).not.toHaveBeenCalled()
    const where = asMock(prisma.stockCount.findFirst).mock.calls[0][0].where
    expect(where).toMatchObject({ id: "count_theirs", store: { accountId: "acct_ours" } })
  })

  it("loads the entry section for our own countId", async () => {
    asMock(prisma.stockCount.findFirst).mockResolvedValue({ id: "count_ours", status: "IN_PROGRESS" })
    asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "ci_flour", name: "flour", category: "Dry Goods", recipeUnit: "lb" },
    ])
    asMock(prisma.stockCountLine.findMany).mockResolvedValue([])
    const sections = getCountSessionSectionPromises({
      countId: "count_ours",
      accountId: "acct_ours",
    })
    const entry = await sections.entry
    expect(entry.status).toBe("ready")
    if (entry.status !== "ready") throw new Error("entry did not load")
    expect(entry.data.rows).toHaveLength(1)
    // The catalogue lookup is still scoped to the account, independently of
    // the count-row lookup.
    expect(asMock(prisma.canonicalIngredient.findMany).mock.calls[0][0].where).toMatchObject({
      accountId: "acct_ours",
    })
  })
})

describe("stock-counts list · model-state scope", () => {
  const OURS = "acct_ours"

  beforeEach(() => {
    vi.clearAllMocks()
    // Two stores for our account; the list loader collects their ids and
    // must use them (and only them) to scope the model-state count.
    asMock(prisma.store.findMany).mockResolvedValue([{ id: "store_a" }, { id: "store_b" }])
    asMock(prisma.stockCount.findMany).mockResolvedValue([])
    asMock(prisma.ingredientModelState.count).mockResolvedValue(0)
  })

  it("scopes the model-state count to the account's stores", async () => {
    const sections = getStockCountsSectionPromises({
      accountId: OURS,
      storeId: null,
      range: { start: new Date(0), end: new Date() },
    })
    await sections.progress

    expect(asMock(prisma.ingredientModelState.count)).toHaveBeenCalledTimes(1)
    const where = asMock(prisma.ingredientModelState.count).mock.calls[0][0].where
    expect(where.storeId).toEqual({ in: ["store_a", "store_b"] })
  })
})
