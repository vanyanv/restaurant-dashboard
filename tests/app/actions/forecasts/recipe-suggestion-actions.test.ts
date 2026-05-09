// getRecipeSuggestions — token-Jaccard ranking of existing recipes for
// items the operator hasn't mapped yet.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: vi.fn() },
    recipe: { findMany: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getRecipeSuggestions } from "@/app/actions/forecasts/recipe-suggestion-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

function recipe(id: string, itemName: string, ingredientCount = 5) {
  return {
    id,
    itemName,
    category: "Mains",
    _count: { ingredients: ingredientCount },
  }
}

function menuItem(
  storeId: string,
  itemName: string,
  qty: number,
  category = "Mains",
) {
  return {
    storeId,
    itemName,
    category,
    fpQuantitySold: qty,
    tpQuantitySold: 0,
  }
}

describe("getRecipeSuggestions", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getRecipeSuggestions({})).toBeNull()
  })

  it("guards cross-account storeId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findFirst).mockResolvedValue(null as never)
    expect(await getRecipeSuggestions({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns no_data when there are no menu items in the window", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
    expect(await getRecipeSuggestions({})).toEqual({
      ok: false,
      error: "no_data",
    })
  })

  it("ranks closely-named recipes above weakly-similar ones", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r-burger", "Smash Burger"),
      recipe("r-bacon-burger", "Bacon Cheeseburger"),
      recipe("r-shake", "Strawberry Shake"),
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuItem("store-A", "Smash Burger Combo", 50),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)

    const result = await getRecipeSuggestions({})
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.items).toHaveLength(1)
    const it = result.data.items[0]
    expect(it.itemName).toBe("Smash Burger Combo")
    // "Smash Burger" should rank higher than "Bacon Cheeseburger" — both
    // share the "burger" token but the former shares "smash" too.
    expect(it.candidates[0].recipeName).toBe("Smash Burger")
    // Strawberry Shake shares no tokens → filtered out below threshold.
    expect(it.candidates.map((c) => c.recipeName)).not.toContain(
      "Strawberry Shake",
    )
  })

  it("excludes items that already have an OtterItemMapping", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r-burger", "Burger"),
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuItem("store-A", "Mapped Item", 10),
      menuItem("store-A", "Unmapped Burger", 5),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { storeId: "store-A", otterItemName: "Mapped Item" },
    ] as never)

    const result = await getRecipeSuggestions({})
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.items.map((i) => i.itemName)).toEqual([
      "Unmapped Burger",
    ])
  })

  it("returns empty candidates list when no recipe is similar enough", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r-shake", "Strawberry Shake"),
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuItem("store-A", "Lobster Roll", 7),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)

    const result = await getRecipeSuggestions({})
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.items[0].candidates).toEqual([])
  })

  it("assigns 'high' confidence on near-exact matches and 'low' on weak matches", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r-exact", "Smash Burger"),
      recipe("r-loose", "Burger Patty"),
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuItem("store-A", "Smash Burger", 100),
      menuItem("store-A", "Cheese Burger Sandwich", 30),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)

    const result = await getRecipeSuggestions({})
    if (!result || !result.ok) throw new Error("expected ok")
    const exact = result.data.items.find((i) => i.itemName === "Smash Burger")!
    expect(exact.candidates[0].confidence).toBe("high")
    expect(exact.candidates[0].similarity).toBeCloseTo(1.0, 5)
    const loose = result.data.items.find(
      (i) => i.itemName === "Cheese Burger Sandwich",
    )!
    expect(loose.candidates[0].confidence).not.toBe("high")
  })

  it("sorts unmapped items by 30-day quantity desc — operator triages biggest first", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r-burger", "Burger"),
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuItem("store-A", "Slow Burger", 5),
      menuItem("store-A", "Fast Burger", 200),
      menuItem("store-A", "Mid Burger", 50),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)

    const result = await getRecipeSuggestions({})
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.items.map((i) => i.itemName)).toEqual([
      "Fast Burger",
      "Mid Burger",
      "Slow Burger",
    ])
  })
})
