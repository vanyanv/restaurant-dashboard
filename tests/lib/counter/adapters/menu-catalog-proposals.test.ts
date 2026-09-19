/**
 * What the reviewer sees before Accept writes a recipe.
 *
 * A proposal whose `proposedRecipeId` is null does not map a POS item onto an
 * existing recipe — `acceptMappingProposal` CREATES one out of
 * `payload.components`, and those lines become a plate cost that reaches
 * `DailyCogsItem`, the COGS page and the P&L food line. The panel showed the
 * item name, the suggested recipe name, one sentence of the model's reasoning
 * and a confidence percentage, and then Accept wrote a recipe nobody had
 * read. "Would map to: a new recipe" is not a description of a recipe.
 *
 * These tests hold the three things that were wrong about that:
 *   · the lines travel out of the adapter at all;
 *   · they travel ONLY for a proposal that would create something, because a
 *     mapping onto an existing recipe writes no lines and showing the
 *     model's guess beside it would describe a recipe nobody is about to make;
 *   · a proposal that would create a recipe with NO lines is distinguishable
 *     from one that would create a full one, since the first is a plate that
 *     costs nothing and shows pure margin on every sale.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/app/actions/mapping-proposal-actions", () => ({
  listMappingProposals: vi.fn(),
}))

import { proposalsOf } from "@/lib/counter/adapters/menu-catalog"
import type { MappingProposalView } from "@/app/actions/mapping-proposal-actions"

function proposal(over: Partial<MappingProposalView> = {}): MappingProposalView {
  return {
    id: "p1",
    otterItemName: "Smash Combo Meal",
    category: "Combos",
    kind: "ITEM",
    confidence: 0.82,
    model: "gpt-4.1-mini",
    proposedRecipeId: null,
    proposedRecipeName: null,
    createdAt: new Date("2026-09-19T00:00:00Z"),
    payload: {
      suggestedName: "Smash Combo Meal",
      suggestedCategory: "Combos",
      reasoning: "Name matches a burger, fries and a drink.",
      confidence: 0.82,
      components: [
        { canonicalIngredientId: "bun", name: "Potato bun", quantity: 1, unit: "each" },
        { componentRecipeId: "patty", name: "Beef patty", quantity: 2, unit: "serving" },
      ],
    },
    ...over,
  }
}

describe("a proposal that would create a recipe shows the recipe", () => {
  it("carries every line Accept would write, with its quantity and unit", () => {
    const [p] = proposalsOf([proposal()], 7).pending
    expect(p.lines).toEqual([
      { name: "Potato bun", quantity: 1, unit: "each", kind: "ingredient" },
      { name: "Beef patty", quantity: 2, unit: "serving", kind: "component" },
    ])
  })

  it("distinguishes a sub-recipe line from an ingredient, which cost differently", () => {
    const [p] = proposalsOf([proposal()], 0).pending
    expect(p.lines.map((l) => l.kind)).toEqual(["ingredient", "component"])
  })

  it("shows nothing when the proposal maps onto a recipe that already exists", () => {
    const [p] = proposalsOf(
      [proposal({ proposedRecipeId: "r9", proposedRecipeName: "Smash Combo" })],
      0,
    ).pending
    expect(p.lines).toEqual([])
    expect(p.proposed).toBe("Smash Combo")
    expect(p.creates).toBe(false)
  })

  it("leaves an empty list visible when the model proposed a recipe with no lines", () => {
    const [p] = proposalsOf(
      [proposal({ payload: { ...proposal().payload, components: [] } })],
      0,
    ).pending
    // The client reads exactly this pair — it would create something, and
    // there is nothing to write — to say the plate would cost nothing. The
    // NAME cannot carry that: a creating proposal still has one, which is why
    // `creates` exists rather than a null check on `proposed`.
    expect(p.proposed).toBe("Smash Combo Meal")
    expect(p.creates).toBe(true)
    expect(p.lines).toEqual([])
  })

  it("tells the reviewer the lines are there to read", () => {
    expect(proposalsOf([proposal()], 0).note).toContain("lines it would write")
  })
})
