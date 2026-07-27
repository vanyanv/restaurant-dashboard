// rankRecipeCandidatesForMenuItems — pgvector cosine ranking of existing
// RecipeEmbedding rows against precomputed MenuItemEmbedding rows. One SQL
// round-trip, no OpenAI call at request time. Pins the grouping by item name,
// per-item candidate limit, similarity ordering, and the no-items short-circuit.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: vi.fn() },
}))

import { prisma } from "@/lib/prisma"
import { rankRecipeCandidatesForMenuItems } from "@/lib/recipe-similarity"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("rankRecipeCandidatesForMenuItems", () => {
  it("returns an empty map without querying when no items are given", async () => {
    const result = await rankRecipeCandidatesForMenuItems({
      accountId: "acct-A",
      items: [],
    })
    expect(result.size).toBe(0)
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("groups candidates by item name, sorted by similarity desc", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        menuItemName: "2 Slider Combo",
        recipeId: "r-combo2",
        recipeName: "Combo 2",
        category: "Combos",
        similarity: 0.83,
      },
      {
        menuItemName: "2 Slider Combo",
        recipeId: "r-slider",
        recipeName: "Double Slider",
        category: "Sliders",
        similarity: 0.61,
      },
      {
        menuItemName: "Chzy Fries",
        recipeId: "r-loaded",
        recipeName: "Loaded Fries",
        category: "Sides",
        similarity: 0.7,
      },
    ] as never)

    const result = await rankRecipeCandidatesForMenuItems({
      accountId: "acct-A",
      items: [
        { storeId: "s1", itemName: "2 Slider Combo", category: "Combos" },
        { storeId: "s1", itemName: "Chzy Fries", category: "Sides" },
      ],
    })

    expect(result.get("2 Slider Combo")).toEqual([
      { recipeId: "r-combo2", recipeName: "Combo 2", category: "Combos", similarity: 0.83 },
      { recipeId: "r-slider", recipeName: "Double Slider", category: "Sliders", similarity: 0.61 },
    ])
    expect(result.get("Chzy Fries")).toHaveLength(1)

    const [sql, ...params] = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0] as [
      string,
      ...unknown[],
    ]
    expect(sql).toContain("MenuItemEmbedding")
    expect(sql).toContain("RecipeEmbedding")
    expect(sql).toContain("<=>")
    expect(params).toContain("acct-A")
    // Item names travel as a bound array param, never interpolated.
    expect(params.some((p) => Array.isArray(p) && p.includes("Chzy Fries"))).toBe(true)
    expect(sql).not.toContain("Chzy Fries")
  })

  it("caps candidates per item via maxCandidates (default 3)", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)

    await rankRecipeCandidatesForMenuItems({
      accountId: "acct-A",
      items: [{ storeId: "s1", itemName: "X", category: "Menu" }],
    })
    let params = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0].slice(1)
    expect(params).toContain(3)

    await rankRecipeCandidatesForMenuItems({
      accountId: "acct-A",
      items: [{ storeId: "s1", itemName: "X", category: "Menu" }],
      maxCandidates: 5,
    })
    params = vi.mocked(prisma.$queryRawUnsafe).mock.calls[1].slice(1)
    expect(params).toContain(5)
  })

  it("returns items with no embedding row absent from the map (caller falls back to Jaccard)", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)
    const result = await rankRecipeCandidatesForMenuItems({
      accountId: "acct-A",
      items: [{ storeId: "s1", itemName: "Brand New Combo", category: "Combos" }],
    })
    expect(result.has("Brand New Combo")).toBe(false)
  })
})
