import { describe, expect, it } from "vitest"
import { buildCatalogPlain } from "@/lib/counter/catalog-plain"
import type { CatalogList, CatalogProposals, CatalogRow } from "@/lib/counter/adapters/menu-catalog"

const row = (item: string, mapped: boolean, soldQty: number, isModifier = false): CatalogRow => ({
  key: item,
  item,
  category: "Burgers",
  price: "$7.99",
  sold: String(soldQty),
  soldQty,
  mapped,
  isModifier,
  plateCost: "—",
  margin: "—",
  dealRunning: false,
  href: `/dashboard/menu/catalog/${item}`,
})

const list: CatalogList = {
  rows: [row("Signature Slider", true, 1302), row("Slider Sgl", false, 40), row("Holiday Box", false, 12), row("Lemonade LG", false, 90), row("Extra cheese", false, 300, true)],
  totalItems: 4,
  totalModifiers: 10,
  unmappedItems: 3,
  unmappedModifiers: 1,
  phoneUnmapped: [],
  phoneTop: [],
}
const proposal = (id: string, item: string, proposed: string | null, creates: boolean): CatalogProposals["pending"][number] => ({
  id,
  item,
  proposed,
  kind: "map",
  confidence: 0.9,
  reasoning: "",
  creates,
  lines: [],
})
const proposals: CatalogProposals = {
  pending: [proposal("p1", "Slider Sgl", "Signature Slider", false), proposal("p2", "Lemonade LG", "Lemonade", false), proposal("p3", "Holiday Box", "Holiday Box", true)],
  unmapped: 3,
  meta: "",
  note: "",
}

describe("buildCatalogPlain", () => {
  it("leads with what to link, most sold first, one tap where a match exists", () => {
    const p = buildCatalogPlain(list, proposals)
    expect(p.sentence).toBe("3 register items aren't linked to a recipe, so what they sell isn't costed. There is a likely match for 2 of them. 1 modifier has no cost yet.")
    expect(p.toLink.map((l) => [l.item, l.match?.recipe ?? null])).toEqual([
      ["Lemonade LG", "Lemonade"],
      ["Slider Sgl", "Signature Slider"],
      ["Holiday Box", null],
    ])
    expect(p.big).toEqual({ label: "Linked to a recipe", value: "1 of 4", sub: "10 modifiers · 9 linked" })
  })

  it("never offers one-tap on a proposal that would create a recipe", () => {
    expect(buildCatalogPlain(list, proposals).toLink.find((l) => l.item === "Holiday Box")?.match).toBeNull()
  })

  it("still lists what to link when the proposal queue did not load", () => {
    const p = buildCatalogPlain(list, null)
    expect(p.toLink.every((l) => l.match === null)).toBe(true)
    expect(p.sentence).not.toMatch(/likely match/)
  })
})
