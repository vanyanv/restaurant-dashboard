import { describe, it, expect } from "vitest"
import {
  NAV_GROUPS, navById, isActive, type NavId,
  COUNT_TABS, CHECKS_TABS, INVOICES_TABS, INGREDIENT_TABS, INVENTORY_TABS,
} from "@/lib/counter/nav"

describe("one door per destination", () => {
  it("lights Inventory on the past-counts pages that used to be Stock on hand's", () => {
    expect(isActive(navById("count"), "/dashboard/count/shelf")).toBe(true)
    expect(isActive(navById("count"), "/dashboard/operations/inventory/counts")).toBe(true)
    expect(isActive(navById("count"), "/dashboard/operations/vendors")).toBe(false)
  })

  it("names no two tabs the same across the families an owner moves between", () => {
    const labels = [...COUNT_TABS, ...CHECKS_TABS, ...INVOICES_TABS, ...INGREDIENT_TABS].map((t) => t.label)
    expect(labels).toEqual(expect.arrayContaining(["Count report", "Checks report", "Price changes", "Ingredient prices"]))
    // Overview and Today are each family's landing tab and read fine twice.
    const named = labels.filter((l) => l !== "Overview" && l !== "Today")
    expect(new Set(named).size).toBe(named.length)
  })

  it("offers one way to start a count", () => {
    expect([...COUNT_TABS, ...INVENTORY_TABS].some((t) => t.href.includes("/count/new"))).toBe(false)
  })
})

describe("nav", () => {
  it("has exactly five groups in the design's order", () => {
    expect(NAV_GROUPS.map((g) => g.caption)).toEqual([
      "Today", "Money", "Menu", "Stock and suppliers", "Admin",
    ])
  })

  it("has exactly twenty-three destinations — a rail item is a decision, not an inventory", () => {
    expect(NAV_GROUPS.flatMap((g) => g.items)).toHaveLength(23)
  })

  it("groups the destinations as the design specifies", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => i.id))).toEqual([
      ["overview", "ask", "needs-you", "checks", "shop", "decisions", "orders"],
      ["analytics", "pnl", "cogs", "labor"],
      ["menu", "recipes", "screens"],
      ["invoices", "count", "ingredients", "vendors"],
      ["stores", "settings", "monitoring", "developer", "people"],
    ])
  })

  it("gives every destination a route under /dashboard", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/dashboard")).toBe(true)
    }
  })

  it("has no duplicate ids or routes", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    expect(new Set(items.map((i) => i.id)).size).toBe(23)
    expect(new Set(items.map((i) => i.href)).size).toBe(23)
  })

  it("navById throws on an unknown id rather than returning undefined", () => {
    expect(navById("pnl").label).toBe("P&L")
    // @ts-expect-error — an unknown id must not type-check either
    expect(() => navById("nope")).toThrow(/unknown nav id/)
  })

  it("marks a destination active for its own route and its children", () => {
    // A detail route keeps its parent lit: /dashboard/invoices/I28517 is
    // still Invoices, which is where the breadcrumb comes from (note 48).
    expect(isActive(navById("invoices"), "/dashboard/invoices")).toBe(true)
    expect(isActive(navById("invoices"), "/dashboard/invoices/I28517")).toBe(true)
    expect(isActive(navById("invoices"), "/dashboard/inventory")).toBe(false)
  })

  it("does not let /dashboard light every item", () => {
    // Overview owns /dashboard exactly; a prefix match would light all 17.
    expect(isActive(navById("overview"), "/dashboard")).toBe(true)
    expect(isActive(navById("overview"), "/dashboard/orders")).toBe(false)
  })
})
