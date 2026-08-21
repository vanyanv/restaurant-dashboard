import { describe, it, expect } from "vitest"
import {
  buildNeedsYou,
  horizonLabel,
  rankValueOf,
  type AlertLike,
} from "@/lib/dashboard/needs-you"
import type { GrowthOpportunity } from "@/types/growth"

function alert(over: Partial<AlertLike> = {}): AlertLike {
  return {
    id: "a1",
    severity: "WATCH",
    source: "PRICE_DELTA",
    title: "Chicken thigh up 38%",
    body: null,
    detectedAt: new Date("2026-08-20T18:00:00Z"),
    ...over,
  }
}

function opp(over: Partial<GrowthOpportunity> = {}): GrowthOpportunity {
  return {
    id: "o1",
    storeId: "s1",
    asOfDate: new Date("2026-08-20"),
    opportunityType: "reprice",
    title: "Reprice the chicken plates",
    estimatedDollarImpact: 2140,
    horizonDays: 30,
    impactP10: 980,
    impactP25: 1480,
    impactP90: 3010,
    confidence: "medium",
    evidence: [],
    caveats: [],
    suggestedAction: "Raise the three chicken items 6%",
    createdAt: new Date("2026-08-20T17:00:00Z"),
    ...over,
  }
}

describe("rankValueOf", () => {
  it("prefers p25 so a wide estimate cannot outrank a tight one", () => {
    expect(rankValueOf(opp())).toBe(1480)
  })

  it("falls back to p10 when p25 is missing", () => {
    expect(rankValueOf(opp({ impactP25: null }))).toBe(980)
  })

  it("falls back to the point estimate when the fit reported no error", () => {
    expect(rankValueOf(opp({ impactP25: null, impactP10: null }))).toBe(2140)
  })
})

describe("horizonLabel", () => {
  it("names what the figure actually covers", () => {
    expect(horizonLabel(1)).toBe("Today")
    expect(horizonLabel(7)).toBe("/ 7 days")
    expect(horizonLabel(30)).toBe("/ 30 days")
  })
})

describe("buildNeedsYou ordering", () => {
  it("puts a critical breach above any opportunity, however large", () => {
    const { items } = buildNeedsYou({
      alerts: [alert({ id: "crit", severity: "CRITICAL", title: "Labor variance" })],
      opportunities: [opp({ impactP25: 999_999 })],
    })
    expect(items[0].id).toBe("alert:crit")
    expect(items[1].id).toBe("opp:o1")
  })

  it("ranks opportunities by their conservative figure", () => {
    // maxPerType lifted so this asserts ordering alone; the cap has its own
    // block below and all three fixtures share a type.
    const { items } = buildNeedsYou({
      alerts: [],
      maxPerType: 3,
      opportunities: [
        opp({ id: "small", impactP25: 400 }),
        opp({ id: "big", impactP25: 4000 }),
        opp({ id: "mid", impactP25: 1500 }),
      ],
    })
    expect(items.map((i) => i.id)).toEqual(["opp:big", "opp:mid", "opp:small"])
  })

  it("keeps watch and info below opportunities", () => {
    const { items } = buildNeedsYou({
      alerts: [
        alert({ id: "w", severity: "WATCH" }),
        alert({ id: "i", severity: "INFO" }),
      ],
      opportunities: [opp({ id: "o" })],
    })
    expect(items.map((i) => i.id)).toEqual(["opp:o", "alert:w", "alert:i"])
  })

  it("shows the newest first within one severity tier", () => {
    const { items } = buildNeedsYou({
      alerts: [
        alert({ id: "old", severity: "CRITICAL", detectedAt: new Date("2026-08-20T10:00:00Z") }),
        alert({ id: "new", severity: "CRITICAL", detectedAt: new Date("2026-08-20T19:00:00Z") }),
      ],
      opportunities: [],
    })
    expect(items.map((i) => i.id)).toEqual(["alert:new", "alert:old"])
  })
})

describe("buildNeedsYou presentation", () => {
  it("gives opportunities a money column and alerts none", () => {
    const { items } = buildNeedsYou({
      alerts: [alert({ id: "a", severity: "CRITICAL" })],
      opportunities: [opp()],
    })
    const [breach, idea] = items
    expect(breach.amount).toBeNull()
    expect(breach.horizon).toBeNull()
    expect(idea.amount).toBe("$1,480")
    expect(idea.horizon).toBe("/ 30 days")
  })

  it("labels the source in operator language", () => {
    const { items } = buildNeedsYou({
      alerts: [alert({ source: "HARRI_VARIANCE" })],
      opportunities: [opp({ opportunityType: "food_cost_risk" })],
    })
    expect(items.map((i) => i.sourceLabel)).toContain("Labor variance")
    expect(items.map((i) => i.sourceLabel)).toContain("Food cost risk")
  })

  it("truncates to the limit and reports what it hid", () => {
    const { items, hiddenCount } = buildNeedsYou({
      alerts: [
        alert({ id: "1" }),
        alert({ id: "2" }),
        alert({ id: "3" }),
        alert({ id: "4" }),
      ],
      opportunities: [
        opp({ id: "a" }),
        opp({ id: "b", opportunityType: "channel_mix" }),
      ],
      limit: 3,
    })
    expect(items).toHaveLength(3)
    expect(hiddenCount).toBe(3)
  })

  it("returns an empty list rather than throwing when nothing needs anyone", () => {
    const { items, hiddenCount } = buildNeedsYou({ alerts: [], opportunities: [] })
    expect(items).toEqual([])
    expect(hiddenCount).toBe(0)
  })
})

describe("buildNeedsYou per-type cap", () => {
  // The generator emits one menu_engineering row per slow-moving item. On a
  // live day that is dozens of near-identical entries at similar dollar values,
  // which took every slot in the queue.
  const slowMovers = Array.from({ length: 12 }, (_, i) =>
    opp({
      id: `slow-${i}`,
      opportunityType: "menu_engineering",
      title: `Slow mover in On The Side: item ${i}`,
      impactP25: 800 - i * 10,
    })
  )

  it("keeps one type from taking every slot", () => {
    const { items } = buildNeedsYou({
      alerts: [],
      opportunities: [...slowMovers, opp({ id: "reprice", impactP25: 400 })],
    })
    const menu = items.filter((i) => i.id.startsWith("opp:slow-"))
    expect(menu).toHaveLength(2)
    expect(items.map((i) => i.id)).toContain("opp:reprice")
  })

  it("keeps the strongest of a capped type, not the first seen", () => {
    const { items } = buildNeedsYou({ alerts: [], opportunities: slowMovers })
    expect(items.map((i) => i.id)).toEqual(["opp:slow-0", "opp:slow-1"])
  })

  it("counts what the cap removed as still outstanding", () => {
    const { items, hiddenCount } = buildNeedsYou({
      alerts: [],
      opportunities: slowMovers,
    })
    expect(items).toHaveLength(2)
    expect(hiddenCount).toBe(10)
  })

  it("honours an explicit cap", () => {
    const { items } = buildNeedsYou({
      alerts: [],
      opportunities: slowMovers,
      maxPerType: 1,
    })
    expect(items).toHaveLength(1)
  })
})
