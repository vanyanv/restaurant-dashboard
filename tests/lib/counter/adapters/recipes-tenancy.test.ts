// recipes adapter — the partial-cost scan's missing store filter.
//
// `loadRecipes`'s `partialDays` query — "how many days has this recipe been
// flagged as a partial-cost understatement" — read `DailyCogsItem` with no
// store filter at all, so a recipe shared by name across accounts (or simply
// another account's `DailyCogsItem` rows) could contribute to this account's
// count. `storeIds` was already computed and used by the `sold` query right
// beside it; the partial-cost scan just never received it.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STORE_IDS = ["store_a", "store_b"]

describe("recipes adapter · partial-cost scan store scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.recipe.findMany).mockResolvedValue([
      {
        id: "r_burger",
        itemName: "Burger",
        category: "Entree",
        isSellable: true,
        isConfirmed: true,
        _count: { ingredients: 3 },
      },
    ])
    asMock(prisma.recipe.count).mockResolvedValue(0)
    asMock(getScopedStores).mockResolvedValue(STORE_IDS.map((id) => ({ id })))
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
    asMock(prisma.$queryRaw).mockResolvedValue([])
  })

  it("passes storeIds into the DailyCogsItem partial-cost scan", async () => {
    const sections = getRecipesSectionPromises({
      storeId: null,
      accountId: "acct_ours",
      range: { start: new Date(0), end: new Date() },
      today: new Date(),
    })
    await sections.headline

    const calls = asMock(prisma.$queryRaw).mock.calls
    const partialCall = calls.find((c) => {
      const strings = c[0] as TemplateStringsArray
      return strings.join(" ").includes("partialCost")
    })
    expect(partialCall).toBeDefined()
    const values = partialCall!.slice(1)
    expect(values.some((v) => Array.isArray(v) && v.includes("store_a") && v.includes("store_b"))).toBe(
      true,
    )
  })
})
