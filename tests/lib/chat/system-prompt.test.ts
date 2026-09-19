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

  it("a narrowed render is a strict subset of the unnarrowed one, line for line", () => {
    const active = ["getDailySales", "getPnlSummary"]
    const { guide } = renderToolGuide(ALL, active)
    const { guide: full } = renderToolGuide(ALL, null)
    expect(full.length).toBeGreaterThan(guide.length)
    // Sliced, never rewritten: every line that survives is a line that was
    // written, unchanged.
    for (const line of guide.split("\n")) {
      if (line.trim() === "") continue
      expect(full).toContain(line)
    }
  })

  it("NAMES NO TOOL THE TURN CANNOT CALL", () => {
    /*
     * The property the whole narrowing exists for, and the one section
     * granularity did not have: one line of `## Sales` says "use
     * `getDailySales` ... do not use `getPnlSummary` for this", so on a turn
     * carrying `getPnlSummary` and not `getDailySales` the prohibition kept
     * the entire section and the model was told to call a tool it had not
     * been given -- while `describeSchema`, correctly narrowed, reported that
     * same tool absent on the same turn.
     */
    const cases: readonly string[][] = [
      ["getPnlSummary", "searchPnlHistory", "listStores", "describeSchema", "fileReturn"],
      ["getDailySales", "listStores", "describeSchema", "fileReturn"],
      ["getRatings", "listStores", "describeSchema", "fileReturn"],
      ["getOrderById", "listOrdersByDay", "getOrderItemFrequency", "fileReturn"],
      ["getRevenueForecast", "getForecastQuality", "fileReturn"],
    ]
    for (const active of cases) {
      const { guide } = renderToolGuide(ALL, active)
      const on = new Set(active)
      const named = [...new Set(guide.match(/`([A-Za-z][A-Za-z0-9]*)`/g) ?? [])]
        .map((m) => m.slice(1, -1))
        .filter((n) => ALL.includes(n))
      const ghosts = named.filter((n) => !on.has(n))
      expect(ghosts, `narrowed to [${active.join(", ")}] but still names: ${ghosts.join(", ")}`).toEqual([])
    }
  })

  it("actually removes most of the guide on a narrow turn", () => {
    // The measurement that made this worth doing: a Labor-shaped turn used to
    // get 67% of the full text. If this ever climbs back, narrowing has
    // quietly stopped working even while the ghost test above passes.
    const active = ["getPnlSummary", "searchPnlHistory", "listStores", "describeSchema", "fileReturn"]
    const { guide } = renderToolGuide(ALL, active)
    const { guide: full } = renderToolGuide(ALL, null)
    expect(guide.length).toBeLessThan(full.length * 0.5)
  })

  it("keeps a bullet's indented continuation with the bullet", () => {
    const active = ["getPnlSummary", "searchPnlHistory", "listStores", "describeSchema", "fileReturn"]
    const { guide } = renderToolGuide(ALL, active)
    // The per-day P&L bullet is followed by a worked example in an indented
    // block. A dropped parent with an orphaned example would read as an
    // instruction with no subject.
    if (guide.includes("what's the daily profit this week?")) {
      expect(guide).toContain("granularity")
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
