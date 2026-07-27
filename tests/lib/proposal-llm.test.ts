// proposal-llm — prompt assembly + response narrowing for AI mapping
// proposals. Pure functions; the OpenAI round-trip itself is mocked at the
// action layer. Pins: the compose-from-existing-recipes instruction, the
// vocabulary lists, and defensive parsing of the model's JSON.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildProposalPrompt, parseProposalDrafts } from "@/lib/proposal-llm"

describe("buildProposalPrompt", () => {
  it("lists the recipe and ingredient vocabulary and the exact-name compose rule", () => {
    const prompt = buildProposalPrompt({
      items: [{ itemName: "3 Slider Combo", category: "Combos", qty30d: 42 }],
      recipeVocab: [
        { itemName: "Double Slider", category: "Sliders" },
        { itemName: "Fries", category: "Sides" },
      ],
      ingredientVocab: ["ground beef", "potato roll"],
    })

    expect(prompt).toContain("3 Slider Combo")
    expect(prompt).toContain("Double Slider")
    expect(prompt).toContain("ground beef")
    // The load-bearing instruction: combos compose EXISTING recipes by exact
    // name so a slider price change flows into every combo automatically.
    expect(prompt.toLowerCase()).toContain("exact name")
    expect(prompt).toContain("COMBO_DECOMPOSITION")
  })

  it("folds confirmed mappings in as house-pattern examples when provided", () => {
    const prompt = buildProposalPrompt({
      items: [{ itemName: "Chris N Eddy's Slider", category: "Sliders", qty30d: 10 }],
      recipeVocab: [{ itemName: "Double Slider", category: "Sliders" }],
      ingredientVocab: [],
      confirmedExamples: [
        { itemName: "Triple Patty Slider", recipeName: "Triple Slider" },
        { itemName: "Bottle of Water", recipeName: "Water" },
      ],
    })

    expect(prompt).toContain('"Triple Patty Slider" → recipe "Triple Slider"')
    expect(prompt).toContain('"Bottle of Water" → recipe "Water"')
  })

  it("omits the examples section when there are none", () => {
    const prompt = buildProposalPrompt({
      items: [{ itemName: "X", category: "Menu", qty30d: 1 }],
      recipeVocab: [{ itemName: "Y", category: "Menu" }],
      ingredientVocab: [],
    })
    expect(prompt).not.toContain("Already-confirmed mappings")
  })

  it("tells the model to echo names verbatim and to prefer MATCH over decomposing", () => {
    const prompt = buildProposalPrompt({
      items: [{ itemName: "2 Sliders and Fries", category: "Combos", qty30d: 10 }],
      recipeVocab: [{ itemName: "2 Slider Combo", category: "Combos" }],
      ingredientVocab: [],
    })

    // Guards against the model appending "[Category]" to returned names and
    // against decomposing combos that already exist as recipes.
    expect(prompt).toContain("never append the [category]")
    expect(prompt).toContain("prefer MATCH over COMBO_DECOMPOSITION")
  })
})

describe("parseProposalDrafts", () => {
  it("parses well-formed drafts", () => {
    const drafts = parseProposalDrafts(
      JSON.stringify({
        proposals: [
          {
            itemName: "3 Slider Combo",
            kind: "COMBO_DECOMPOSITION",
            suggestedName: "3 Slider Combo",
            suggestedCategory: "Combos",
            components: [
              { type: "recipe", name: "Double Slider", quantity: 3, unit: "each" },
              { type: "recipe", name: "Fries", quantity: 1, unit: "each" },
            ],
            reasoning: "Three sliders plus a fries portion.",
            confidence: 0.85,
          },
        ],
      })
    )

    expect(drafts).toHaveLength(1)
    expect(drafts[0].kind).toBe("COMBO_DECOMPOSITION")
    expect(drafts[0].components).toHaveLength(2)
  })

  it("drops drafts with unknown kinds and components with bad shapes", () => {
    const drafts = parseProposalDrafts(
      JSON.stringify({
        proposals: [
          { itemName: "X", kind: "HALLUCINATED_KIND", components: [], reasoning: "", confidence: 1 },
          {
            itemName: "Y",
            kind: "NEW_RECIPE",
            components: [
              { type: "ingredient", name: "beef", quantity: "lots", unit: "oz" }, // bad qty
              { type: "ingredient", name: "bun", quantity: 1, unit: "each" },
            ],
            reasoning: "ok",
            confidence: 0.7,
          },
        ],
      })
    )

    expect(drafts).toHaveLength(1)
    expect(drafts[0].itemName).toBe("Y")
    expect(drafts[0].components).toHaveLength(1)
    expect(drafts[0].components[0].name).toBe("bun")
  })

  it("strips the [Category] suffix the model copies from the vocabulary list", () => {
    const drafts = parseProposalDrafts(
      JSON.stringify({
        proposals: [
          {
            itemName: "Bottle of Water [Drinks]",
            kind: "MATCH",
            matchRecipeName: "Water [Drinks]",
            components: [],
            reasoning: "same item",
            confidence: 0.95,
          },
          {
            itemName: "2 Slider Combo [Combos]",
            kind: "COMBO_DECOMPOSITION",
            suggestedName: "2 Slider Combo",
            suggestedCategory: "Combos",
            components: [
              { type: "recipe", name: "Double Slider [Sliders]", quantity: 2, unit: "each" },
            ],
            reasoning: "two sliders",
            confidence: 0.9,
          },
        ],
      })
    )

    expect(drafts[0].itemName).toBe("Bottle of Water")
    expect(drafts[0].matchRecipeName).toBe("Water")
    expect(drafts[1].itemName).toBe("2 Slider Combo")
    expect(drafts[1].components[0].name).toBe("Double Slider")
  })

  it("returns [] on non-JSON or missing proposals array", () => {
    expect(parseProposalDrafts("not json")).toEqual([])
    expect(parseProposalDrafts(JSON.stringify({ nope: true }))).toEqual([])
  })

  it("clamps confidence into [0, 1]", () => {
    const drafts = parseProposalDrafts(
      JSON.stringify({
        proposals: [
          {
            itemName: "Z",
            kind: "MATCH",
            matchRecipeName: "Fries",
            components: [],
            reasoning: "same item",
            confidence: 7,
          },
        ],
      })
    )
    expect(drafts[0].confidence).toBe(1)
  })
})
