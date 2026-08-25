import { describe, it, expect } from "vitest"
import { NAV_GROUPS, navById, isActive, type NavId } from "@/lib/counter/nav"

describe("nav", () => {
  it("has exactly five groups in the design's order", () => {
    expect(NAV_GROUPS.map((g) => g.caption)).toEqual([
      "Today", "Money", "Menu", "Stock and suppliers", "Admin",
    ])
  })

  it("has exactly seventeen destinations — a rail item is a decision, not an inventory", () => {
    expect(NAV_GROUPS.flatMap((g) => g.items)).toHaveLength(17)
  })

  it("groups the destinations as the design specifies", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => i.id))).toEqual([
      ["overview", "ask", "needs-you", "orders"],
      ["analytics", "pnl", "cogs", "labor"],
      ["menu", "recipes"],
      ["invoices", "inventory", "ingredients", "vendors"],
      ["stores", "settings", "monitoring"],
    ])
  })

  it("gives every destination a route under /dashboard", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/dashboard")).toBe(true)
    }
  })

  it("has no duplicate ids or routes", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    expect(new Set(items.map((i) => i.id)).size).toBe(17)
    expect(new Set(items.map((i) => i.href)).size).toBe(17)
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
