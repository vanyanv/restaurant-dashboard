/*
 * The prompt is narrowed per turn now, and the whole point of the narrowing
 * is that it must not change what a NON-narrowed turn is sent. The golden
 * set's fingerprint is a hash of the rendered prompt, so a stray newline in
 * the reassembly would invalidate a scorecard that cost real money to record
 * and would look, from the failure message, like a deliberate prompt change.
 *
 * Byte-identity is therefore an assertion, not a hope.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { renderToolGuide } from "@/lib/chat/system-prompt"

const ALL = [
  "listStores",
  "describeSchema",
  "fileReturn",
  "getDailySales",
  "getHourlyTrend",
  "compareSales",
  "getPlatformBreakdown",
  "getStoreBreakdown",
  "getPnlSummary",
  "searchPnlHistory",
  "getRefunds",
  "getRatings",
  "getAlerts",
  "getForecastQuality",
  "getRevenueForecast",
  "getInventoryStatus",
  "getOrderById",
  "listOrdersByDay",
  "getOrderItemFrequency",
  "getRecipeByName",
  "searchRecipes",
]

function whole(all: readonly string[]): string {
  const { head, guide, tail } = renderToolGuide(all, null)
  return head + guide + tail
}

describe("renderToolGuide", () => {
  it("reassembles byte-for-byte when nothing is narrowed", () => {
    const unnarrowed = whole(ALL)
    // Same inputs, second call — the parse is cached, so this also proves the
    // cache does not mutate what it hands back.
    expect(whole(ALL)).toBe(unnarrowed)
    expect(unnarrowed).toContain("# Tool selection guide")
    expect(unnarrowed).toContain("# Self-check before sending")
  })

  it("the unnarrowed render does not depend on the order of the tool list", () => {
    const reversed = [...ALL].reverse()
    expect(whole(reversed)).toBe(whole(ALL))
  })

  it("drops a section whose tools this turn cannot call", () => {
    const active = ["listStores", "describeSchema", "fileReturn", "getDailySales"]
    const { guide } = renderToolGuide(ALL, active)
    expect(guide).toContain("getDailySales")
    // The orders drilldown section names only order tools, none of them active.
    expect(guide).not.toContain("getOrderItemFrequency")
    expect(guide).not.toContain("getForecastQuality")
  })

  it("keeps a section as soon as ONE of its tools is active", () => {
    const active = ["getRatings"]
    const { guide } = renderToolGuide(ALL, active)
    expect(guide).toContain("getRatings")
  })

  it("keeps a section that names no tool at all", () => {
    // The preamble's storeIds rule mentions no backticked tool name and is
    // true of every turn, so narrowing must never remove it.
    const { guide } = renderToolGuide(ALL, ["getDailySales"])
    expect(guide).toContain("copy the exact ids from the per-request context")
  })

  it("a narrowed render is a strict subset of the unnarrowed one", () => {
    const active = ["getDailySales", "getPnlSummary"]
    const { guide } = renderToolGuide(ALL, active)
    const { guide: full } = renderToolGuide(ALL, null)
    expect(full.length).toBeGreaterThan(guide.length)
    for (const section of guide.split(/\n(?=## )/)) {
      expect(full).toContain(section.trim())
    }
  })

  it("narrowing to everything is the same text as not narrowing", () => {
    const { guide: narrowed } = renderToolGuide(ALL, ALL)
    const { guide: full } = renderToolGuide(ALL, null)
    expect(narrowed).toBe(full)
  })

  it("head and tail are never narrowed", () => {
    const a = renderToolGuide(ALL, null)
    const b = renderToolGuide(ALL, ["getDailySales"])
    expect(b.head).toBe(a.head)
    expect(b.tail).toBe(a.tail)
  })
})
