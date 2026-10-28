import { describe, expect, it } from "vitest"
import {
  defaultLayers,
  describeShelf,
  guessArea,
  parseLayers,
  resolveLayers,
  shelfTotal,
} from "@/lib/counter/count-layers"

describe("resolveLayers", () => {
  it("chains a case through chubs down to pounds, in the recipe unit", () => {
    const r = resolveLayers(
      [
        { label: "Cases", qty: 4, of: "Chubs" },
        { label: "Chubs", qty: 10, of: "lb" },
        { label: "Opened (lb)", qty: 1, of: "lb" },
      ],
      "oz",
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.layers.map((l) => l.per)).toEqual([640, 160, 16])
  })

  it("counts pressed patties as 1.5 oz each", () => {
    const r = resolveLayers([{ label: "Patties", qty: 1.5, of: "oz" }], "lb")
    expect(r.ok && r.layers[0].per).toBeCloseTo(0.09375)
  })

  it("takes a count unit that matches the recipe unit by name", () => {
    const r = resolveLayers([{ label: "Case", qty: 9, of: "Pack" }, { label: "Pack", qty: 8, of: "each" }], "each")
    expect(r.ok && r.layers.map((l) => l.per)).toEqual([72, 8])
  })

  it("refuses a layer pointing up the list, a unit that can't convert, and a zero", () => {
    expect(resolveLayers([{ label: "Cases", qty: 4, of: "lb" }, { label: "Chubs", qty: 1, of: "Cases" }], "lb").ok).toBe(false)
    expect(resolveLayers([{ label: "Case", qty: 1, of: "gal" }], "lb").ok).toBe(false)
    expect(resolveLayers([{ label: "Case", qty: 0, of: "lb" }], "lb").ok).toBe(false)
    expect(resolveLayers([], "lb").ok).toBe(false)
  })
})

describe("shelfTotal", () => {
  const layers = [
    { label: "Cases", qty: 4, of: "Chubs", per: 40 },
    { label: "Chubs", qty: 10, of: "lb", per: 10 },
    { label: "Opened", qty: 1, of: "lb", per: 1 },
  ]
  it("adds every layer through its per", () => {
    expect(shelfTotal(layers, [2, 3, 4.5])).toBe(114.5)
  })
  it("treats blanks, negatives and NaN as nothing", () => {
    expect(shelfTotal(layers, [null, -2, Number.NaN])).toBe(0)
  })
  it("says what was typed", () => {
    expect(describeShelf(layers, [2, 0, 4.5])).toBe("2 Cases + 4.5 Opened")
  })
})

describe("parseLayers", () => {
  it("keeps good layers and drops malformed ones", () => {
    expect(parseLayers([{ label: "Case", per: 12, qty: 12, of: "each" }, { label: "x" }, null, "y"])).toEqual([
      { label: "Case", qty: 12, of: "each", quarters: false, per: 12 },
    ])
    expect(parseLayers("nope")).toEqual([])
  })
})

describe("guessArea", () => {
  it("places items by supplier category", () => {
    expect(guessArea("Frozen Foods")).toBe("freezer")
    expect(guessArea("Paper/Supplies")).toBe("dry")
    expect(guessArea("Produce")).toBe("walk_in")
    expect(guessArea(null)).toBe("walk_in")
  })
})

describe("defaultLayers", () => {
  it("starts ounce items in pounds and everything else in its recipe unit", () => {
    expect(defaultLayers("oz")).toEqual([{ label: "Loose (lb)", qty: 1, of: "lb", quarters: false, per: 16 }])
    expect(defaultLayers("each")[0].per).toBe(1)
  })
})
