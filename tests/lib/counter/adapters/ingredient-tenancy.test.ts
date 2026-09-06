// ingredient adapter — the account-wide count-line tally.
//
// `loadIngredient` scoped its per-ingredient `stockCountLine.count` by
// `canonicalIngredientId`, but its second call — "how many count lines exist
// on the account at all", the figure the `onHand` cell falls back to when
// this ingredient itself has never been counted — ran with no `where` at
// all, so it counted every account's stock-count lines, not just ours.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findFirst: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe("ingredient adapter · account-wide count-line scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ci_ours",
      name: "house tomato",
      recipeUnit: "lb",
      category: "Produce",
      costPerRecipeUnit: 1.2,
      costSource: "invoice",
      costLocked: false,
    })
    asMock(prisma.$queryRaw).mockResolvedValue([])
    asMock(prisma.ingredientSkuMatch.findMany).mockResolvedValue([])
    asMock(prisma.recipeIngredient.findMany).mockResolvedValue([])
    asMock(prisma.stockCountLine.count).mockResolvedValue(0)
    asMock(getScopedStores).mockResolvedValue([])
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
  })

  it("scopes both stockCountLine.count calls to our own account", async () => {
    const sections = getIngredientSectionPromises({
      ingredientId: "ci_ours",
      storeId: null,
      accountId: "acct_ours",
      range: { start: new Date(0), end: new Date() },
      today: new Date(),
    })
    await sections.head

    const calls = asMock(prisma.stockCountLine.count).mock.calls
    expect(calls).toHaveLength(2)
    // one call is scoped by ingredientId; the account-wide one must be scoped too
    expect(calls.some((c) => c[0]?.where?.stockCount?.store?.accountId === "acct_ours")).toBe(true)
    expect(calls.every((c) => c[0] !== undefined)).toBe(true)
  })
})
