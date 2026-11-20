import { describe, expect, it } from "vitest"
import { buildItemsPlain, matchesFilter } from "@/lib/counter/menu-items-plain"
import type { MenuItemRow, MenuItemsData, NeedRow } from "@/lib/counter/adapters/menu-items"

const row = (id: string, glyph: MenuItemRow["glyph"], sold: number, category = "Burgers"): MenuItemRow => ({
  id,
  name: id,
  category,
  href: `/dashboard/recipes/${id}`,
  photo: null,
  glyph,
  why: "why",
  posNames: 1,
  sold,
  soldLabel: String(sold),
  avgPrice: "$7.99",
  plateCost: "$2.37",
  foodCostPct: 0.3,
  foodCost: "29.7%",
  keep: "$5.62",
})
const need = (key: string, glyph: NeedRow["glyph"], title: string): NeedRow => ({
  key,
  glyph,
  title,
  sub: "",
  what: `${title} has nothing in it.`,
  amount: "",
  act: { label: "Set it up", href: `/dashboard/recipes/${title}` },
  photo: null,
  weight: 1,
})

const data = (): MenuItemsData => ({
  counts: {
    dishes: 4,
    sellingDishes: 3,
    fullyCosted: 1,
    notCosted: 1,
    notCostedSold: 41,
    staleIngredients: 2,
    staleExample: "Pickles",
    cost: 300,
    revenue: 1000,
  },
  needs: [need("a", "miss", "Halal Slider"), need("b", "open", "Lemonade")],
  items: [row("Slider", "ok", 1302), row("Halal Slider", "miss", 41), row("Lemonade", "open", 200, "Drinks"), row("Shake", "up", 0, "Drinks")],
  categories: ["Burgers", "Drinks"],
})

describe("buildItemsPlain", () => {
  it("says how many dishes are costed, what is not, and which prices are old", () => {
    const p = buildItemsPlain(data())
    expect(p.sentence).toBe(
      "1 of 3 dishes that sold are fully costed, and food was 30.0% of what they collected. 1 dish sold 41 times with nothing counted for food, so it needs a recipe first. 2 ingredient prices are more than 90 days old, Pickles among them.",
    )
    expect(p.big).toMatchObject({ value: "30.0%", missing: "1 not costed" })
  })

  it("never shows an uncosted dish as a $0 plate", () => {
    const halal = buildItemsPlain(data()).dishes.find((d) => d.name === "Halal Slider")!
    expect(halal).toMatchObject({ keep: "not costed", detail: "sold 41 · no recipe yet", status: { text: "Not costed", tone: "bad" } })
  })

  it("folds the to-dos into one group per kind, each with one fix", () => {
    expect(buildItemsPlain(data()).needs).toEqual([
      { key: "miss", what: "1 dish selling with no recipe", why: "Halal Slider has nothing in it.", act: { label: "Set it up", href: "/dashboard/recipes/Halal Slider" } },
      { key: "open", what: "1 dish to check", why: "Lemonade has nothing in it.", act: { label: "Set it up", href: "/dashboard/recipes/Lemonade" } },
    ])
  })

  it("filters by status and by the menu's own groups, most sold first", () => {
    const p = buildItemsPlain(data())
    expect(p.dishes.map((d) => d.name)).toEqual(["Slider", "Lemonade", "Halal Slider", "Shake"])
    expect(p.filters.map((f) => `${f.label} ${f.n}`)).toEqual(["All 4", "Not costed 1", "Needs your eye 1", "Burgers 2", "Drinks 2"])
    expect(p.dishes.filter((d) => matchesFilter(d, "cat:Drinks")).map((d) => d.name)).toEqual(["Lemonade", "Shake"])
  })
})
