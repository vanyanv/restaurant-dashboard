/*
 * Ask prints a "Read · invoices · sales" row under every answer, and that row
 * is the product's whole argument: an answer names what it read. A tool with
 * no entry here prints its raw identifier, so the row came out as
 * `GETPNLSUMMARY` and `GETINVENTORYCOVERAGE` on three surfaces for a month.
 * Thirty-six of fifty-eight tools were missing. This makes the next omission
 * a failing test instead of a shipped screen.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/recipe-cost", () => ({ computeRecipeCost: vi.fn() }))

import { chatTools } from "@/lib/chat/tools"
import { TOOL_LABELS, labelFor } from "@/components/chat/tool-labels"
import { TOOL_GROUPS } from "@/lib/chat/tool-groups"
import { SHOWABLE_TOOLS } from "@/lib/chat/present"

describe("tool labels", () => {
  it("every registered tool has a plain-English label", () => {
    const missing = Object.keys(chatTools).filter((n) => !(n in TOOL_LABELS))
    expect(missing, `add these to TOOL_LABELS: ${missing.join(", ")}`).toEqual([])
  })

  it("no label describes a tool that no longer exists", () => {
    const registered = new Set(Object.keys(chatTools))
    const stale = Object.keys(TOOL_LABELS).filter((n) => !registered.has(n))
    expect(stale, `these labels name nothing: ${stale.join(", ")}`).toEqual([])
  })

  it("labels are lowercase ledger-voice fragments, not identifiers", () => {
    for (const [name, label] of Object.entries(TOOL_LABELS)) {
      expect(label.short, name).not.toMatch(/^[a-z]+[A-Z]/)
      expect(label.running.length, name).toBeGreaterThan(0)
      expect(label.done.length, name).toBeGreaterThan(0)
    }
  })

  it("falls back rather than rendering nothing for an unknown tool", () => {
    expect(labelFor("somethingNew").short).toBe("somethingNew")
  })
})

describe("tool routing tables", () => {
  it("every tool named in a group is a registered tool", () => {
    const registered = new Set(Object.keys(chatTools))
    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
      for (const t of tools) expect(registered, `${group}`).toContain(t)
    }
  })

  it("every showable tool is a registered tool", () => {
    const registered = new Set(Object.keys(chatTools))
    for (const t of SHOWABLE_TOOLS) expect(registered).toContain(t)
  })

  it("every registered tool is reachable from at least one page, or is always on", () => {
    // A tool in the registry and in no group can only ever be called on a turn
    // that established no department at all — which is a tool nobody routed to.
    const ALWAYS = new Set(["fileReturn", "listStores", "describeSchema"])
    const grouped = new Set(Object.values(TOOL_GROUPS).flat())
    const orphans = Object.keys(chatTools).filter(
      (n) => !grouped.has(n as never) && !ALWAYS.has(n),
    )
    expect(orphans, `these tools are in no group: ${orphans.join(", ")}`).toEqual([])
  })
})

describe("freshness stamps", () => {
  it("every tool that reads figures has an asOf source", async () => {
    // A tool with no entry reports no stamp, and `everyToolStamped` then
    // refuses to cache ANY answer that read it — so an unstamped new tool
    // silently costs a model call on every repeat of every question it
    // touches. The exemptions below are decisions, each with a reason.
    const { TOOL_AS_OF } = await import("@/lib/chat/data-as-of")
    const EXEMPT: Record<string, string> = {
      listStores: "structure, and a store can be added without a sync",
      describeSchema: "structure",
      fileReturn: "presentation, reads nothing",
      simulatePriceChange: "computes over inputs stamped by their own tools",
      getMenuItemElasticity: "a fitted model, not a synced table",
      // The catalogue tools are edited by hand rather than synced, so they
      // have no refresh moment to report.
      getMenuPrices: "hand-edited catalogue",
      searchMenuItems: "hand-edited catalogue",
      getMenuItemDetails: "hand-edited catalogue",
      searchCanonicalIngredients: "hand-edited catalogue",
      listIngredientGaps: "hand-edited catalogue",
      listRecipesByIngredient: "hand-edited catalogue",
      searchRecipes: "hand-edited catalogue",
      getRecipeByName: "hand-edited catalogue",
      getRecipeById: "hand-edited catalogue",
      rankRecipes: "hand-edited catalogue",
      listRecipesByCategory: "hand-edited catalogue",
      listVendorLeadTimes: "hand-edited catalogue",
      getInventoryStatus: "hand-edited catalogue",
      getInventoryCoverage: "hand-edited catalogue",
      listStockCounts: "hand-edited catalogue",
      getRecentInventoryAdjustments: "hand-edited catalogue",
      getOpenAnomalies: "detector output, stamped by the alert inbox instead",
    }
    const unstamped = Object.keys(chatTools).filter(
      (n) => !(n in TOOL_AS_OF) && !(n in EXEMPT),
    )
    expect(
      unstamped,
      `give these a TOOL_AS_OF source or an exemption with a reason: ${unstamped.join(", ")}`,
    ).toEqual([])
  })
})
