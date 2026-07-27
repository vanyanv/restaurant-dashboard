// getRecipeSuggestions — embedding-first candidate ranking with token-Jaccard
// fallback (the documented v2). Pins: embedding candidates win when a
// MenuItemEmbedding row exists, cosine confidence bands, the Jaccard fallback
// for not-yet-embedded items, and the below-threshold filter.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/recipe-similarity", () => ({
  rankRecipeCandidatesForMenuItems: vi.fn(),
}))
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
import { rankRecipeCandidatesForMenuItems } from "@/lib/recipe-similarity"
import { getRecipeSuggestions } from "@/app/actions/forecasts/recipe-suggestion-actions"

const menuRow = (itemName: string, qty: number) => ({
  storeId: "s1",
  itemName,
  category: "Menu",
  fpQuantitySold: qty,
  tpQuantitySold: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "u1", accountId: "acct-A" },
  } as never)
  vi.mocked(prisma.store.findFirst).mockResolvedValue({
    id: "s1",
    name: "Hollywood",
  } as never)
  vi.mocked(prisma.recipe.findMany).mockResolvedValue([
    { id: "r-combo2", itemName: "Combo 2", category: "Combos", _count: { ingredients: 6 } },
    { id: "r-fries", itemName: "Chzy Fries Deluxe", category: "Sides", _count: { ingredients: 3 } },
  ] as never)
  vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(rankRecipeCandidatesForMenuItems).mockResolvedValue(new Map())
})

describe("getRecipeSuggestions — embedding-first with Jaccard fallback", () => {
  it("uses embedding candidates (cosine confidence bands) when the item is embedded", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuRow("2 Slider Combo", 50),
    ] as never)
    vi.mocked(rankRecipeCandidatesForMenuItems).mockResolvedValue(
      new Map([
        [
          "2 Slider Combo",
          [
            { recipeId: "r-combo2", recipeName: "Combo 2", category: "Combos", similarity: 0.7 },
            { recipeId: "r-fries", recipeName: "Chzy Fries Deluxe", category: "Sides", similarity: 0.4 },
          ],
        ],
      ])
    )

    const result = await getRecipeSuggestions({ storeId: "s1" })
    if (!result?.ok) throw new Error("expected ok")

    const combo = result.data.items.find((i) => i.itemName === "2 Slider Combo")!
    expect(combo.candidates[0]).toMatchObject({
      recipeId: "r-combo2",
      similarity: 0.7,
      // Cosine is capped at "medium" — the 2026-07-26 eval showed wrong
      // matches scoring up to 0.752, so cosine must never feed the
      // confidence==="high" batch-confirm path.
      confidence: "medium",
      ingredientCount: 6, // joined from account recipes
    })
    expect(combo.candidates[1]).toMatchObject({
      recipeId: "r-fries",
      confidence: "low", // 0.35 ≤ 0.4 < 0.50
    })

    // The ranker was asked about the unmapped item.
    const call = vi.mocked(rankRecipeCandidatesForMenuItems).mock.calls[0][0]
    expect(call.accountId).toBe("acct-A")
    expect(call.items.map((i) => i.itemName)).toContain("2 Slider Combo")
  })

  it("drops embedding candidates below the cosine floor (0.35)", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuRow("Mystery Item", 10),
    ] as never)
    vi.mocked(rankRecipeCandidatesForMenuItems).mockResolvedValue(
      new Map([
        [
          "Mystery Item",
          [{ recipeId: "r-combo2", recipeName: "Combo 2", category: "Combos", similarity: 0.2 }],
        ],
      ])
    )

    const result = await getRecipeSuggestions({ storeId: "s1" })
    if (!result?.ok) throw new Error("expected ok")
    const item = result.data.items.find((i) => i.itemName === "Mystery Item")!
    expect(item.candidates).toHaveLength(0)
  })

  it("falls back to token-Jaccard for items with no embedding row", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuRow("Chzy Fries", 20),
    ] as never)
    // Ranker knows nothing about this item (embedded after next backfill).
    vi.mocked(rankRecipeCandidatesForMenuItems).mockResolvedValue(new Map())

    const result = await getRecipeSuggestions({ storeId: "s1" })
    if (!result?.ok) throw new Error("expected ok")

    const item = result.data.items.find((i) => i.itemName === "Chzy Fries")!
    // {chzy, fries} vs {chzy, fries, deluxe} → Jaccard 2/3 → medium.
    expect(item.candidates[0]).toMatchObject({
      recipeId: "r-fries",
      confidence: "medium",
    })
    expect(item.candidates[0].similarity).toBeCloseTo(2 / 3)
  })

  it("still excludes already-mapped items before ranking", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      menuRow("Mapped Thing", 30),
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { storeId: "s1", otterItemName: "Mapped Thing" },
    ] as never)

    const result = await getRecipeSuggestions({ storeId: "s1" })
    if (!result?.ok) throw new Error("expected ok")
    expect(result.data.items).toHaveLength(0)
  })
})
