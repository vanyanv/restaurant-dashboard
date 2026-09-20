// recipe adapter — the cost trend's missing store filter.
//
// `loadRecipe`'s trend query — "what has this plate cost per serving over the
// last 21 days" — read `DailyCogsItem` with no store clause, so it averaged
// every store's cost for the recipe. The strip directly above the chart, and
// the `sold` query beside it in the same `Promise.all`, both honour the store
// switcher. So picking one store moved the figures and left the chart showing
// a blend of all of them, with nothing on screen saying the two disagreed.
//
// `storeIds` was already computed for `sold`; the trend just never received
// it. The guard mirrors `sold`'s: an empty scope skips the query rather than
// emitting `= ANY('{}')`.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findFirst: vi.fn(), findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STORE_IDS = ["store_hollywood", "store_glendale"]

/** The trend is the only raw query in this adapter that reads DailyCogsItem. */
const isTrendQuery = (c: unknown[]) =>
  (c[0] as TemplateStringsArray).join(" ").includes("DailyCogsItem")

const input = () => ({
  recipeId: "r_double_slider",
  storeId: null,
  accountId: "acct_ours",
  range: { start: new Date("2026-08-01"), end: new Date("2026-08-26") },
  today: new Date("2026-08-26"),
})

describe("recipe adapter · cost trend store scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.recipe.findFirst).mockResolvedValue({
      id: "r_double_slider",
      itemName: "Double Slider",
      category: "Slider",
      isSellable: true,
      isConfirmed: true,
      servingSize: 1,
      foodCostOverride: null,
      notes: null,
      ingredients: [],
    })
    asMock(prisma.recipe.findMany).mockResolvedValue([])
    asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])
    asMock(getScopedStores).mockResolvedValue(STORE_IDS.map((id) => ({ id })))
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
    asMock(prisma.$queryRaw).mockResolvedValue([])
  })

  it("passes storeIds into the DailyCogsItem trend query", async () => {
    const sections = getRecipeSectionPromises(input())
    await sections.trend

    const trendCall = asMock(prisma.$queryRaw).mock.calls.find(isTrendQuery)
    expect(trendCall).toBeDefined()

    const values = trendCall!.slice(1)
    expect(
      values.some(
        (v) => Array.isArray(v) && v.includes("store_hollywood") && v.includes("store_glendale"),
      ),
    ).toBe(true)
  })

  it("skips the trend query entirely when the account has no scoped stores", async () => {
    asMock(getScopedStores).mockResolvedValue([])

    const sections = getRecipeSectionPromises(input())

    // Resolves rather than throwing from `= ANY('{}')`, like `sold`'s guard.
    const trend = await sections.trend
    expect(trend.status).not.toBe("error")

    expect(asMock(prisma.$queryRaw).mock.calls.find(isTrendQuery)).toBeUndefined()
  })
})
