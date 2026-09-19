/**
 * The recipe editor's contract, at the layer that decides what the screen
 * offers.
 *
 * Every one of these guards a figure or a control that would look right and
 * be wrong:
 *
 * 1. **A header field that is not a control.** Four of a recipe's six fields
 *    rendered as `<span>`s, which is why `servingSize` is 1 on all sixty rows
 *    in this account — the product had never had a box to type it in.
 *    `builderOf` is what turns them into controls, so a regression here is
 *    the whole data model going unreachable again.
 * 2. **A unit box that offers a unit the cost engine cannot use.** A line
 *    reading `2 cup` against a price per `lb` costs $0.00 on every recosting
 *    for the life of the recipe and the plate still reports as costed. The
 *    options must never include one.
 * 3. **A hand-typed price wearing a vendor's name.** The cost layer pulls
 *    vendor, SKU and invoice date from the latest matched line even when the
 *    price itself was typed in, so the row read "Sysco · part 3589484 ·
 *    $0.33 / each · 6 days ago" over a figure with no invoice behind it.
 * 4. **A per-serving cost with nothing saying it was divided.** `$2.01` off a
 *    batch of 24 and `$2.01` off a single plate are different claims.
 * 5. **A delete button that always throws.** `deleteRecipe` refuses while
 *    anything uses the recipe as a component.
 */
import { describe, it, expect, vi } from "vitest"

// The adapter imports `@/lib/prisma` at module load, which throws without a
// DATABASE_URL. The functions under test take their data as an argument and
// touch none of it — the same shape every other adapter test relies on.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", async () => ({ batchRecipeCosts: vi.fn() }))

import { builderOf, costOf, headOf, unitChoices, type Loaded } from "@/lib/counter/adapters/recipe"
import type { RecipeCostLine } from "@/lib/recipe-cost"

const TODAY = new Date("2026-09-19T00:00:00Z")

function line(over: Partial<RecipeCostLine> = {}): RecipeCostLine {
  return {
    kind: "ingredient",
    refId: "flour",
    name: "flour",
    quantity: 2,
    unit: "lb",
    unitCost: 0.5,
    costUnit: "lb",
    lineCost: 1,
    missingCost: false,
    costSource: "invoice",
    sourceVendor: "Sysco",
    sourceSku: "3589484",
    sourceInvoiceDate: new Date("2026-09-13T00:00:00Z"),
    ...over,
  }
}

function loaded(over: Partial<Loaded> = {}): Loaded {
  return {
    id: "r1",
    name: "Double Slider",
    category: "Burgers",
    servingSize: 1,
    yieldUnit: null,
    notes: null,
    isSellable: true,
    isConfirmed: false,
    override: null,
    lines: [line()],
    totalCost: 1,
    batchCost: 1,
    computedCost: 1,
    partial: false,
    emptyWalk: false,
    hasLines: true,
    overrideApplied: false,
    categoryOf: new Map([["flour", "Dry goods"]]),
    categories: ["Burgers", "Sides"],
    usedInCount: 0,
    usedInName: null,
    costUnitOf: new Map([["flour", "lb"]]),
    componentUnits: new Map(),
    pantry: [],
    components: [],
    posNames: [],
    trend: [],
    soldQty: 0,
    revenue: 0,
    price: null,
    rangeLabel: "the last 30 days",
    packaging: { n: 0, spend: 0 },
    ...over,
  }
}

describe("every field a recipe's cost depends on is a control", () => {
  it("emits all six, each with a kind a control can be built from", () => {
    const b = builderOf(loaded(), TODAY)
    expect(b.fields.map((f) => f.key)).toEqual([
      "itemName",
      "category",
      "servingSize",
      "yieldUnit",
      "foodCostOverride",
      "notes",
    ])
    expect(b.fields.every((f) => f.kind !== undefined)).toBe(true)
  })

  it("offers the account's own categories rather than a free text box", () => {
    const b = builderOf(loaded(), TODAY)
    const category = b.fields.find((f) => f.key === "category")
    expect(category?.kind).toBe("select")
    expect(category?.options?.map((o) => o.value)).toEqual(["Burgers", "Sides"])
  })

  it("lets the yield be portions, which is what a blank unit means", () => {
    const b = builderOf(loaded(), TODAY)
    const unit = b.fields.find((f) => f.key === "yieldUnit")
    expect(unit?.value).toBe("")
    expect(unit?.options?.[0]).toEqual({ value: "", label: "portions" })
  })

  it("labels the fallback plainly and says it is a BATCH cost once the recipe is a batch", () => {
    const plate = builderOf(loaded(), TODAY).fields.find((f) => f.key === "foodCostOverride")
    expect(plate?.label).toBe("Fallback batch cost")
    expect(plate?.hint).not.toContain("whole batch")

    const batch = builderOf(
      loaded({ servingSize: 24, yieldUnit: "fl oz" }),
      TODAY,
    ).fields.find((f) => f.key === "foodCostOverride")
    expect(batch?.hint).toContain("whole batch")
    expect(batch?.hint).toContain("divided by the yield")
  })
})

describe("an incomplete recipe distinguishes booked COGS from its known minimum", () => {
  it("explains both figures when the fallback is in use", () => {
    const missing = line({
      refId: "wing",
      name: "wing",
      missingCost: true,
      missingReason: "no-price",
      unitCost: null,
      lineCost: 0,
    })
    const c = costOf(
      loaded({
        lines: [line({ lineCost: 0.5 }), missing],
        totalCost: 6,
        batchCost: 6,
        computedCost: 0.5,
        partial: true,
        overrideApplied: true,
      }),
    )

    expect(c.gap?.lead).toBe("fallback in use")
    expect(c.gap?.body).toContain("known minimum of $0.50")
    expect(c.gap?.body).toContain("$6.00 fallback is what goes into COGS")
  })
})

describe("a line may only be measured in something its price can convert into", () => {
  it("offers the mass family against a price per pound, and no volume", () => {
    const b = builderOf(loaded(), TODAY)
    expect(b.lines[0].unitOptions).toEqual(["lb", "oz", "kg", "g"])
    expect(b.lines[0].unitOptions).not.toContain("cup")
  })

  it("offers the sub-recipe's own batch units for a component line", () => {
    const b = builderOf(
      loaded({
        lines: [
          line({ kind: "component", refId: "sauce", name: "House Sauce", unit: "fl oz", costUnit: "fl oz" }),
        ],
        componentUnits: new Map([["sauce", ["gal", "qt", "pt", "cup", "fl oz", "l", "ml"]]]),
      }),
      TODAY,
    )
    expect(b.lines[0].unitOptions).toContain("cup")
    expect(b.lines[0].unitOptions).not.toContain("lb")
  })

  it("keeps a unit it does not recognise rather than leaving the line unfixable", () => {
    const b = builderOf(
      loaded({
        lines: [line({ unit: "sleeve", costUnit: "sleeve" })],
        costUnitOf: new Map([["flour", "sleeve"]]),
      }),
      TODAY,
    )
    expect(b.lines[0].unitOptions).toEqual(["sleeve"])
  })
})

describe("a line says why it could not be priced, not just that it could not", () => {
  it("names a unit that cannot convert, which is a different fix from a missing price", () => {
    const b = builderOf(
      loaded({
        lines: [line({ missingCost: true, missingReason: "unit-mismatch", unit: "cup", costUnit: "lb" })],
      }),
      TODAY,
    )
    expect(b.lines[0].missingWhy).toContain("cup")
    expect(b.lines[0].missingWhy).toContain("lb")
  })

  it("names the batch's unit when a sub-recipe line cannot be measured against it", () => {
    const b = builderOf(
      loaded({
        lines: [
          line({
            kind: "component",
            refId: "sauce",
            missingCost: true,
            missingReason: "yield-mismatch",
            costUnit: "fl oz",
          }),
        ],
      }),
      TODAY,
    )
    expect(b.lines[0].missingWhy).toContain("fl oz")
  })
})

describe("a hand-typed price does not wear a vendor's name", () => {
  it("says it was entered by hand and drops the invoice it did not come from", () => {
    const b = builderOf(loaded({ lines: [line({ costSource: "manual" })] }), TODAY)
    expect(b.lines[0].sub).toContain("entered by hand")
    expect(b.lines[0].sub).not.toContain("Sysco")
    expect(b.lines[0].sub).not.toContain("3589484")
    // And it is not aged against an invoice date that is not its source.
    expect(b.lines[0].priceAgeDays).toBeNull()
  })

  it("keeps vendor, part and age on an invoiced price", () => {
    const b = builderOf(loaded(), TODAY)
    expect(b.lines[0].sub).toContain("Sysco")
    expect(b.lines[0].sub).toContain("part 3589484")
    expect(b.lines[0].priceAgeDays).toBe(6)
  })

  it("says so on the cost panel, because a typed price has no history", () => {
    const c = costOf(loaded({ lines: [line({ costSource: "manual" })] }))
    expect(c.foot).toContain("typed in rather than invoiced")
    expect(costOf(loaded()).foot).not.toContain("typed in")
  })

  it("prints the waste an ingredient carries, which nothing modelled before", () => {
    const b = builderOf(loaded({ lines: [line({ yieldFactor: 0.8 })] }), TODAY)
    expect(b.lines[0].sub).toContain("20.0% waste")
  })
})

describe("a per-serving figure says it was divided", () => {
  it("shows the batch and the yield behind it", () => {
    const c = costOf(loaded({ servingSize: 24, yieldUnit: "fl oz", batchCost: 48, totalCost: 2 }))
    expect(c.batch).toContain("48.00")
    expect(c.batch).toContain("24 fl oz")
  })

  it("says nothing on an ordinary one-plate recipe, where there is nothing to divide", () => {
    expect(costOf(loaded()).batch).toBeNull()
  })
})

describe("delete explains itself rather than throwing", () => {
  it("is open when nothing draws on the recipe", () => {
    expect(builderOf(loaded(), TODAY).deleteBlockedBy).toBeNull()
  })

  it("names the recipe standing in the way", () => {
    const b = builderOf(loaded({ usedInCount: 1, usedInName: "Smash Combo" }), TODAY)
    expect(b.deleteBlockedBy).toContain("Smash Combo")
  })

  it("counts them when there is more than one", () => {
    const b = builderOf(loaded({ usedInCount: 3, usedInName: "Smash Combo" }), TODAY)
    expect(b.deleteBlockedBy).toContain("3")
    expect(b.deleteBlockedBy).toContain("Smash Combo")
  })
})

describe("the cost bar is in the same unit as the figure above it", () => {
  it("divides bands by the yield, so a batch recipe's bands add to the per-serving cost", () => {
    const c = costOf(
      loaded({
        servingSize: 24,
        yieldUnit: null,
        batchCost: 48,
        totalCost: 2,
        lines: [line({ quantity: 12, lineCost: 48 })],
      }),
    )
    // Not $48.00, which is what the bar read under a $2.00 headline.
    expect(c.bands[0].value).toBe("$2.00")
    expect(c.bands[0].weight).toBeCloseTo(2)
  })

  it("leaves a one-plate recipe exactly as it was", () => {
    const c = costOf(loaded())
    expect(c.bands[0].value).toBe("$1.00")
  })
})

describe("the headline does not report unpriced lines on a recipe that has none", () => {
  it("says there are no lines when there are no lines", () => {
    const h = headOf(
      loaded({ lines: [], hasLines: false, emptyWalk: true, overrideApplied: true, totalCost: 3 }),
    )
    expect(h.cells[0].delta).toContain("no lines")
  })

  it("says a line is unpriced when one is", () => {
    const h = headOf(
      loaded({
        lines: [line(), line({ missingCost: true })],
        hasLines: true,
        overrideApplied: true,
        totalCost: 3,
      }),
    )
    expect(h.cells[0].delta).toContain("unpriced")
  })
})

/*
 * The unit picker exists to make the permanent $0.00 line unreachable. A
 * fallback that answers with a SUB-RECIPE's portion label defeats that for an
 * ingredient: an unpriced pantry item was offered "serving" while the line it
 * produced carried "each", so the control handed out a unit the ingredient can
 * never be measured in and validation waved it through (an ingredient with no
 * recipe unit is exempt, by design).
 */
describe("an ingredient is never offered a unit it cannot be measured in", () => {
  it("falls back to the count family, not the portion label", () => {
    expect(unitChoices("each")).toContain("each")
    expect(unitChoices("each")).not.toContain("serving")
  })

  it("offers the price's own family", () => {
    expect(unitChoices("lb")).toEqual(["lb", "oz", "kg", "g"])
  })

  it("keeps a unit it does not recognise rather than offering nothing usable", () => {
    expect(unitChoices("sleeve")).toEqual(["sleeve"])
  })
})
