import { describe, expect, it } from "vitest"
import {
  defaultLayers,
  describeShelf,
  guessArea,
  normalizeArea,
  packLayers,
  unconverted,
  storedAreasFor,
  areaLabel,
  layersFor,
  parseLayers,
  resolveLayers,
  shelfTotal,
  valuesFit,
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
    expect(guessArea("Frozen Foods")).toBe("frozen")
    expect(guessArea("Paper/Supplies")).toBe("packaging")
    expect(guessArea("Chemicals")).toBe("cleaning")
    expect(guessArea("Beverage")).toBe("drinks")
    expect(guessArea("Produce")).toBe("fridge")
    expect(guessArea(null)).toBe("fridge")
  })
})

describe("defaultLayers", () => {
  it("starts ounce items in pounds and everything else in its recipe unit", () => {
    expect(defaultLayers("oz")).toEqual([{ label: "Loose (lb)", qty: 1, of: "lb", quarters: false, per: 16 }])
    expect(defaultLayers("each")[0].per).toBe(1)
  })
})

describe("layersFor and valuesFit", () => {
  it("works per out again from the recipe unit, so a unit change can't skew the count", () => {
    const stored = [{ label: "Chubs", qty: 10, of: "lb", per: 10 }]
    expect(layersFor(stored, "oz")[0].per).toBe(160)
    expect(layersFor(null, "each")[0].label).toBe("Loose (each)")
  })
  it("drops values typed against a different set of layers", () => {
    const layers = layersFor([{ label: "Case", qty: 4, of: "Chubs", per: 40 }, { label: "Chubs", qty: 10, of: "lb", per: 10 }], "lb")
    expect(valuesFit(layers, [1, 2])).toBe(true)
    expect(valuesFit(layers, [3])).toBe(false)
    expect(valuesFit(layers, null)).toBe(false)
  })
})

describe("normalizeArea", () => {
  it("old sections map onto the sheet's six", () => {
    expect(normalizeArea("walk_in")).toBe("fridge")
    expect(normalizeArea("freezer")).toBe("frozen")
    expect(normalizeArea("line")).toBe("fridge")
    expect(normalizeArea("dry")).toBe("dry")
    expect(areaLabel("walk_in")).toBe("Refrigeration")
  })
})

describe("storedAreasFor", () => {
  it("includes the old ids that now show as the same section", () => {
    expect(storedAreasFor("fridge").sort()).toEqual(["fridge", "line", "walk_in"])
    expect(storedAreasFor("walk_in").sort()).toEqual(["fridge", "line", "walk_in"])
    expect(storedAreasFor("dry")).toEqual(["dry"])
  })
})

describe("boxes with no size yet (count like the sheet)", () => {
  it("keeps an unsized tray out of the total and names it", () => {
    const r = resolveLayers(
      [
        { label: "Cases", qty: 25, of: "lb" },
        { label: "Trays", qty: 0, of: "lb", unsized: true },
      ],
      "lb",
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.layers[1]).toMatchObject({ unsized: true, per: 0 })
    expect(shelfTotal(r.layers, [3, 2])).toBe(75)
    expect(unconverted(r.layers, [3, 2])).toBe("2 Trays")
    expect(unconverted(r.layers, [3, 0])).toBeNull()
  })

  it("a layer made of unsized ones is unsized too, and all-unsized is allowed", () => {
    const r = resolveLayers(
      [
        { label: "Cases", qty: 4, of: "Chubs" },
        { label: "Chubs", qty: 0, of: "lb", unsized: true },
      ],
      "lb",
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.layers.every((l) => l.unsized)).toBe(true)
    expect(shelfTotal(r.layers, [0, 14])).toBe(0)
    expect(unconverted(r.layers, [0, 14])).toBe("14 Chubs")
  })

  it("survives a save and reload", () => {
    const r = resolveLayers([{ label: "Trays", qty: 0, of: "lb", unsized: true }, { label: "Loose (lb)", qty: 1, of: "lb" }], "lb")
    if (!r.ok) throw new Error(r.error)
    const back = parseLayers(JSON.parse(JSON.stringify(r.layers)))
    expect(back).toHaveLength(2)
    expect(back[0].unsized).toBe(true)
    expect(layersFor(back, "lb")[0].unsized).toBe(true)
  })
})

describe("packLayers", () => {
  it("fries: cases of 6 bags of 4.5 lb, entered as cases and bags", () => {
    const l = packLayers({ recipeUnit: "lb", recipeUnitsPerCase: 27, innerPacksPerCase: 6 })
    expect(l.map((x) => x.label)).toEqual(["Cases", "Packs"])
    expect(l[0].per).toBe(27)
    expect(l[1].per).toBe(4.5)
    expect(shelfTotal(l, [5, 6])).toBe(162)
  })

  it("no inner packs: cases plus loose", () => {
    const l = packLayers({ recipeUnit: "each", recipeUnitsPerCase: 1000, innerPacksPerCase: null })
    expect(l[0]).toMatchObject({ label: "Cases", per: 1000 })
    expect(l).toHaveLength(2)
  })

  it("no case size on file: the plain default", () => {
    expect(packLayers({ recipeUnit: "lb", recipeUnitsPerCase: null, innerPacksPerCase: null })).toEqual(defaultLayers("lb"))
  })
})
