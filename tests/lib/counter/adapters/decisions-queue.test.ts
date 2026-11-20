import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildDecisionQueue, DECAYS_WORDS, hrefFor } from "@/lib/counter/adapters/decisions"
import { impactBasis, type DecisionAction } from "@/app/actions/decisions/get-decisions-view"
import type { GrowthOpportunity } from "@/types/growth"

function action(over: Partial<DecisionAction>): DecisionAction {
  return {
    id: "a1",
    storeId: "s1",
    category: "Pricing",
    type: "reprice",
    title: "Raise price on Bacon Eddy by $0.25",
    rawTitle: "Raise price on Bacon Eddy by $0.25",
    impactUsdPerWeek: 120,
    impactRangeUsdPerWeek: null,
    why: "Raise the menu price on Bacon Eddy by $0.25 on Otter and watch its sales over the next 14 days.",
    basis: "Estimate: what the change adds a week if sales respond to price the way the last 90 non-promo days suggest.",
    deadline: { kind: "decays" },
    dots: 3,
    confidence: "medium",
    evidence: [{ kind: "elasticity_fit", ref: "MenuItemElasticity:Bacon Eddy", value: "-0.4" }],
    ...over,
  } as DecisionAction
}

describe("decision links", () => {
  it("an action about one item opens that item's page", () => {
    expect(hrefFor(action({}))).toBe("/dashboard/menu/catalog/bacon-eddy")
    expect(
      hrefFor(
        action({
          type: "menu_engineering",
          evidence: [{ kind: "item_velocity", ref: "DailyCogsItem:2 Slider Combo", value: "1.2" }],
        }),
      ),
    ).toBe("/dashboard/menu/catalog/2-slider-combo")
  })

  it("falls back to a route that exists", () => {
    expect(hrefFor(action({ type: "launch_analogue" as DecisionAction["type"], evidence: [] }))).toBe(
      "/dashboard/decisions",
    )
  })
})

describe("decision cards say what the figure is", () => {
  it("body carries the basis and plain deadline words", () => {
    const [item] = buildDecisionQueue([action({})], "2026-11-19")
    expect(item.body).toContain("Estimate:")
    expect(item.body).toContain("last 90 non-promo days")
    expect(item.note).toBe(DECAYS_WORDS)
    expect(item.body).not.toContain("decays daily")
    expect(item.act).toBe("Open Bacon Eddy")
  })

  it("names the assumption from the generator's evidence", () => {
    const base = {
      id: "o", storeId: "s", asOfDate: new Date(), title: "t", estimatedDollarImpact: -900,
      horizonDays: 7, impactP10: null, impactP25: null, impactP90: null, confidence: "low",
      caveats: [], suggestedAction: "", createdAt: new Date(),
    } as unknown as GrowthOpportunity
    expect(
      impactBasis({ ...base, opportunityType: "profit_risk", evidence: [{ kind: "missing_inputs", ref: "d", value: "rent" }] }),
    ).toContain("some costs are not on file")
    expect(
      impactBasis({ ...base, opportunityType: "food_cost_risk", evidence: [{ kind: "uncosted_items", ref: "d", value: 2 }] }),
    ).toContain("2 items have no cost on file")
  })
})
