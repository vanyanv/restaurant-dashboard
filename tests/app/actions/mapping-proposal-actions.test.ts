// mapping-proposal-actions — the propose + one-click-confirm loop for
// unmapped POS items (new combos, renames). Pins: generation skips
// batch-confirmable and already-proposed items, server-side name→id
// resolution of LLM output, MATCH acceptance writing only mappings, combo
// acceptance creating a composed recipe transactionally, and rejection
// never touching Recipe/OtterItemMapping.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/proposal-llm", () => ({
  generateProposalDrafts: vi.fn(),
  PROPOSAL_MODEL: "gpt-4.1-mini",
}))
vi.mock("@/lib/recipe-suggestions-core", () => ({
  computeRecipeSuggestions: vi.fn(),
}))
vi.mock("@/lib/recipe-cost", () => ({ assertNoCycles: vi.fn() }))
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    store: { findMany: vi.fn() },
    recipe: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    recipeIngredient: { createMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    otterItemMapping: { upsert: vi.fn(), findMany: vi.fn() },
    recipeMappingProposal: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  }
  prisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[])
  )
  return { prisma }
})

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { generateProposalDrafts } from "@/lib/proposal-llm"
import { computeRecipeSuggestions } from "@/lib/recipe-suggestions-core"
import { assertNoCycles } from "@/lib/recipe-cost"
import {
  generateMappingProposals,
  acceptMappingProposal,
  rejectMappingProposal,
} from "@/app/actions/mapping-proposal-actions"

const scope = { ownerId: "u1", accountId: "acct-A" }

const suggestionItem = (
  itemName: string,
  confidence: "high" | "medium" | "low" | null
) => ({
  storeId: "s1",
  itemName,
  category: "Combos",
  qty30d: 40,
  candidates: confidence
    ? [
        {
          recipeId: "r-any",
          recipeName: "Whatever",
          category: "Menu",
          similarity: 0.8,
          confidence,
          ingredientCount: 3,
        },
      ]
    : [],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue(scope as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never)
  vi.mocked(prisma.recipe.findMany).mockResolvedValue([
    { id: "r-slider", itemName: "Double Slider", category: "Sliders" },
    { id: "r-fries", itemName: "Fries", category: "Sides" },
  ] as never)
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
    { id: "can-beef", name: "Ground Beef" },
  ] as never)
  vi.mocked(prisma.recipeMappingProposal.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.recipeMappingProposal.create).mockImplementation(((args: unknown) =>
    Promise.resolve(args)) as never)
  vi.mocked(generateProposalDrafts).mockResolvedValue({ drafts: [], model: "gpt-4.1-mini" })
})

describe("generateMappingProposals", () => {
  it("returns an error when not authenticated", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null as never)
    const result = await generateMappingProposals({})
    expect(result).toEqual({ ok: false, error: "not_authenticated" })
  })

  it("skips high-confidence items and items with existing proposals; resolves LLM components server-side", async () => {
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        items: [
          suggestionItem("Obvious Rename", "high"), // batch-confirm path
          suggestionItem("Already Proposed", "low"),
          suggestionItem("3 Slider Combo", null),
        ],
      },
    } as never)
    vi.mocked(prisma.recipeMappingProposal.findMany).mockResolvedValue([
      { otterItemName: "Already Proposed", status: "REJECTED" },
    ] as never)
    vi.mocked(generateProposalDrafts).mockResolvedValue({
      model: "gpt-4.1-mini",
      drafts: [
        {
          itemName: "3 Slider Combo",
          kind: "COMBO_DECOMPOSITION",
          suggestedName: "3 Slider Combo",
          suggestedCategory: "Combos",
          components: [
            { type: "recipe", name: "double slider", quantity: 3, unit: "each" },
            { type: "recipe", name: "Ghost Recipe", quantity: 1, unit: "each" }, // unresolvable
            { type: "ingredient", name: "Ground Beef", quantity: 2, unit: "oz" },
          ],
          reasoning: "Three sliders and extra beef.",
          confidence: 0.8,
        },
      ],
    })

    const result = await generateMappingProposals({ storeId: "s1" })

    expect(result).toMatchObject({ ok: true, created: 1, skippedExisting: 1 })

    // Only the eligible item reached the LLM.
    const llmInput = vi.mocked(generateProposalDrafts).mock.calls[0][0]
    expect(llmInput.items.map((i) => i.itemName)).toEqual(["3 Slider Combo"])

    // Stored payload has ids resolved, the unresolvable line dropped, and
    // confidence decremented for the drop.
    const createArgs = vi.mocked(prisma.recipeMappingProposal.create).mock.calls[0][0]
    expect(createArgs.data).toMatchObject({
      accountId: "acct-A",
      otterItemName: "3 Slider Combo",
      kind: "COMBO_DECOMPOSITION",
      status: "PENDING",
      model: "gpt-4.1-mini",
    })
    const payload = createArgs.data.payload as {
      components: Array<Record<string, unknown>>
      confidence: number
    }
    expect(payload.components).toHaveLength(2)
    expect(payload.components[0]).toMatchObject({
      componentRecipeId: "r-slider",
      quantity: 3,
    })
    expect(payload.components[1]).toMatchObject({
      canonicalIngredientId: "can-beef",
      quantity: 2,
    })
    expect(payload.confidence).toBeCloseTo(0.7)
  })

  it("drops register free-text items (Uncategorized, trace qty) before any proposal work", async () => {
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        items: [
          // Fake register open-items — must never be proposed or sent to the LLM.
          { ...suggestionItem("096 a combo 2", null), category: "Uncategorized", qty30d: 1 },
          { ...suggestionItem("load 1 fry 949", null), category: "Uncategorized", qty30d: 2 },
          // Uncategorized but selling for real — still eligible.
          { ...suggestionItem("New Seasonal Item", null), category: "Uncategorized", qty30d: 25 },
        ],
      },
    } as never)

    const result = await generateMappingProposals({ storeId: "s1" })

    expect(result).toMatchObject({ ok: true, created: 0 })
    const llmInput = vi.mocked(generateProposalDrafts).mock.calls[0][0]
    expect(llmInput.items.map((i) => i.itemName)).toEqual(["New Seasonal Item"])
  })

  it("resolves normalized exact-name matches deterministically without calling the LLM", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { id: "r-scf", itemName: "Straight Cut Fries", category: "Sides" },
      { id: "r-slider", itemName: "Double Slider", category: "Sliders" },
    ] as never)
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        // Hyphen/trailing-space variants of an existing recipe name.
        items: [
          suggestionItem("Straight-Cut Fries", "medium"),
          suggestionItem("Straight Cut Fries ", "low"),
        ],
      },
    } as never)

    const result = await generateMappingProposals({ storeId: "s1" })

    expect(result).toMatchObject({ ok: true, created: 2 })
    // Every item resolved deterministically — zero LLM spend.
    expect(generateProposalDrafts).not.toHaveBeenCalled()
    const creates = vi.mocked(prisma.recipeMappingProposal.create).mock.calls
    expect(creates).toHaveLength(2)
    expect(creates[0][0].data).toMatchObject({
      otterItemName: "Straight-Cut Fries",
      kind: "MATCH",
      proposedRecipeId: "r-scf",
      status: "PENDING",
    })
    expect(creates[1][0].data).toMatchObject({
      otterItemName: "Straight Cut Fries ",
      proposedRecipeId: "r-scf",
    })
  })

  it("does not exact-match when the normalized name is ambiguous across recipes", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { id: "r-a", itemName: "Loaded Fries", category: "Sides" },
      { id: "r-b", itemName: "Loaded Fries!", category: "Specials" },
    ] as never)
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        items: [suggestionItem("Loaded Fries", "medium")],
      },
    } as never)

    const result = await generateMappingProposals({ storeId: "s1" })

    // Ambiguous → falls through to the LLM instead of guessing.
    expect(result).toMatchObject({ ok: true, created: 0 })
    expect(generateProposalDrafts).toHaveBeenCalledTimes(1)
  })

  it("matches drafts back to items leniently and stores the real POS name", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { id: "r-sauce", itemName: "Extra Chris N Eddy's Sauce", category: "Sides" },
    ] as never)
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        items: [suggestionItem("Extra Sauce ", "low")], // trailing space in POS
      },
    } as never)
    // One identity mapping (no signal, dropped) and one renamed mapping
    // (kept as a house-pattern example for the prompt).
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Loaded Fries", recipe: { itemName: "Loaded Fries" } },
      { otterItemName: "Triple Patty Slider", recipe: { itemName: "Triple Slider" } },
    ] as never)
    // Model trims the item name and echoes the recipe with a bracket tag —
    // parse strips the bracket; the action must still resolve both.
    vi.mocked(generateProposalDrafts).mockResolvedValue({
      model: "gpt-4.1-mini",
      drafts: [
        {
          itemName: "Extra Sauce",
          kind: "MATCH",
          matchRecipeName: "extra chris n eddy's sauce",
          components: [],
          reasoning: "Same item, shorter POS label.",
          confidence: 0.95,
        },
      ],
    })

    const result = await generateMappingProposals({ storeId: "s1" })

    expect(result).toMatchObject({ ok: true, created: 1 })
    const createArgs = vi.mocked(prisma.recipeMappingProposal.create).mock.calls[0][0]
    expect(createArgs.data).toMatchObject({
      // The stored name is the exact POS spelling, not the model's echo —
      // acceptMappingProposal upserts OtterItemMapping by this string.
      otterItemName: "Extra Sauce ",
      kind: "MATCH",
      proposedRecipeId: "r-sauce",
    })

    // Only the renamed mapping made it into the few-shot examples.
    const llmInput = vi.mocked(generateProposalDrafts).mock.calls[0][0]
    expect(llmInput.confirmedExamples).toEqual([
      { itemName: "Triple Patty Slider", recipeName: "Triple Slider" },
    ])
  })

  it("discards drafts with zero resolvable components", async () => {
    vi.mocked(computeRecipeSuggestions).mockResolvedValue({
      ok: true,
      data: {
        storeId: "s1",
        storeName: "Hollywood",
        windowStart: new Date(),
        windowEnd: new Date(),
        items: [suggestionItem("Mystery Box", null)],
      },
    } as never)
    vi.mocked(generateProposalDrafts).mockResolvedValue({
      model: "gpt-4.1-mini",
      drafts: [
        {
          itemName: "Mystery Box",
          kind: "NEW_RECIPE",
          suggestedName: "Mystery Box",
          suggestedCategory: "Menu",
          components: [
            { type: "recipe", name: "Nonexistent", quantity: 1, unit: "each" },
          ],
          reasoning: "??",
          confidence: 0.5,
        },
      ],
    })

    const result = await generateMappingProposals({ storeId: "s1" })
    expect(result).toMatchObject({ ok: true, created: 0 })
    expect(prisma.recipeMappingProposal.create).not.toHaveBeenCalled()
  })
})

describe("acceptMappingProposal", () => {
  it("MATCH: upserts mappings across stores without creating a recipe", async () => {
    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue({
      id: "prop-1",
      accountId: "acct-A",
      otterItemName: "Straight Cut Fries ",
      category: "Sides",
      kind: "MATCH",
      proposedRecipeId: "r-fries",
      payload: { components: [], reasoning: "", confidence: 0.9 },
      status: "PENDING",
    } as never)
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue({ id: "r-fries" } as never)

    const result = await acceptMappingProposal("prop-1")

    expect(result).toEqual({ ok: true, recipeId: "r-fries" })
    expect(prisma.recipe.create).not.toHaveBeenCalled()
    const upserts = vi.mocked(prisma.otterItemMapping.upsert).mock.calls
    expect(upserts).toHaveLength(2)
    expect(upserts[0][0].create).toMatchObject({
      storeId: "s1",
      otterItemName: "Straight Cut Fries ",
      recipeId: "r-fries",
    })
    expect(vi.mocked(prisma.recipeMappingProposal.update).mock.calls[0][0].data).toMatchObject({
      status: "ACCEPTED",
      resultRecipeId: "r-fries",
      decidedById: "u1",
    })
  })

  it("COMBO: creates a composed recipe (isAiGenerated + isConfirmed), checks cycles, maps it", async () => {
    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue({
      id: "prop-2",
      accountId: "acct-A",
      otterItemName: "3 Slider Combo",
      category: "Combos",
      kind: "COMBO_DECOMPOSITION",
      proposedRecipeId: null,
      payload: {
        suggestedName: "3 Slider Combo",
        suggestedCategory: "Combos",
        components: [
          { componentRecipeId: "r-slider", name: "Double Slider", quantity: 3, unit: "each" },
          { canonicalIngredientId: "can-beef", name: "Ground Beef", quantity: 2, unit: "oz" },
        ],
        reasoning: "",
        confidence: 0.7,
      },
      status: "PENDING",
    } as never)
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null as never) // no name collision
    vi.mocked(prisma.recipe.create).mockResolvedValue({ id: "r-new" } as never)

    const result = await acceptMappingProposal("prop-2")

    expect(result).toEqual({ ok: true, recipeId: "r-new" })
    expect(vi.mocked(prisma.recipe.create).mock.calls[0][0].data).toMatchObject({
      accountId: "acct-A",
      itemName: "3 Slider Combo",
      category: "Combos",
      isAiGenerated: true,
      isConfirmed: true,
    })
    const ingredientRows = vi.mocked(prisma.recipeIngredient.createMany).mock.calls[0][0]!
      .data as Array<Record<string, unknown>>
    expect(ingredientRows).toHaveLength(2)
    expect(ingredientRows[0]).toMatchObject({
      recipeId: "r-new",
      componentRecipeId: "r-slider",
      quantity: 3,
    })
    expect(ingredientRows[1]).toMatchObject({
      recipeId: "r-new",
      canonicalIngredientId: "can-beef",
    })
    expect(assertNoCycles).toHaveBeenCalledWith("r-new", expect.anything())
    expect(vi.mocked(prisma.otterItemMapping.upsert).mock.calls).toHaveLength(2)
  })

  it("maps to the existing recipe instead of creating a duplicate on name collision", async () => {
    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue({
      id: "prop-3",
      accountId: "acct-A",
      otterItemName: "3 Slider Combo",
      category: "Combos",
      kind: "COMBO_DECOMPOSITION",
      proposedRecipeId: null,
      payload: {
        suggestedName: "3 Slider Combo",
        suggestedCategory: "Combos",
        components: [
          { componentRecipeId: "r-slider", name: "Double Slider", quantity: 3, unit: "each" },
        ],
        reasoning: "",
        confidence: 0.7,
      },
      status: "PENDING",
    } as never)
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue({ id: "r-existing" } as never)

    const result = await acceptMappingProposal("prop-3")

    expect(result).toEqual({ ok: true, recipeId: "r-existing" })
    expect(prisma.recipe.create).not.toHaveBeenCalled()
  })

  it("rejects unknown or already-decided proposals", async () => {
    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue(null as never)
    expect(await acceptMappingProposal("nope")).toEqual({ ok: false, error: "not_found" })

    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue({
      id: "prop-4",
      accountId: "acct-A",
      status: "ACCEPTED",
    } as never)
    expect(await acceptMappingProposal("prop-4")).toEqual({ ok: false, error: "not_pending" })
    expect(prisma.otterItemMapping.upsert).not.toHaveBeenCalled()
  })
})

describe("rejectMappingProposal", () => {
  it("marks the proposal REJECTED and touches nothing else", async () => {
    vi.mocked(prisma.recipeMappingProposal.findFirst).mockResolvedValue({
      id: "prop-5",
      accountId: "acct-A",
      status: "PENDING",
    } as never)

    const result = await rejectMappingProposal("prop-5")

    expect(result).toEqual({ ok: true })
    expect(vi.mocked(prisma.recipeMappingProposal.update).mock.calls[0][0].data).toMatchObject({
      status: "REJECTED",
      decidedById: "u1",
    })
    expect(prisma.recipe.create).not.toHaveBeenCalled()
    expect(prisma.otterItemMapping.upsert).not.toHaveBeenCalled()
  })
})
