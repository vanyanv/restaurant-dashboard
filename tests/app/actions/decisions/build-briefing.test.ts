// buildBriefing has six line generators. Until now the Decisions page called it
// with `cash: null, lostSales: null, menuEngineering: null, targetCogsPct: null`,
// so three generators were unreachable and `cogsLine` could only ever take its
// target-less branch. These tests pin the behaviour of the branches that were
// dead in production, so wiring the real inputs in can't silently change what
// the owner reads.

import { describe, it, expect } from "vitest"
import {
  buildBriefing,
  type BriefingLine,
} from "@/app/actions/decisions/build-briefing"
import type { RevenueForecastData } from "@/app/actions/forecasts/revenue-forecast-actions"
import type { CashPositionData } from "@/app/actions/forecasts/cash-position-actions"
import type { FoodCostForecastData } from "@/app/actions/forecasts/food-cost-forecast-actions"
import type { OpenAnomaliesData } from "@/app/actions/forecasts/anomaly-actions"
import type { LostSalesData } from "@/app/actions/forecasts/lost-sales-actions"
import type { MenuEngineeringData } from "@/app/actions/forecasts/menu-engineering-actions"

const DAY = 86_400_000
const d = (offset: number) => new Date(Date.UTC(2026, 7, 18) + offset * DAY)

/** Flatten a line back to the sentence the owner actually reads. */
const text = (line: BriefingLine) => line.chunks.map((c) => c.value).join("")

const find = (lines: BriefingLine[], kind: BriefingLine["kind"]) =>
  lines.find((l) => l.kind === kind)

// --- fixtures ---------------------------------------------------------------

/** 14 days of forecast: `next7` each `a`, trailing 7 each `b`. */
function revenue(a: number, b: number): RevenueForecastData {
  const day = (i: number, predictedRevenue: number) => ({
    date: d(i),
    predictedRevenue,
    p10: predictedRevenue * 0.9,
    p90: predictedRevenue * 1.1,
    modelVersion: "test",
    generatedAt: d(0),
    forecastSource: "native" as const,
  })
  return {
    storeId: "store-1",
    storeName: "Hollywood",
    generatedAt: d(0),
    recentMape: 0.064,
    openedAt: d(-400),
    days: [
      ...Array.from({ length: 7 }, (_, i) => day(i, a)),
      ...Array.from({ length: 7 }, (_, i) => day(i + 7, b)),
    ],
  }
}

function cash(floor: number): CashPositionData {
  const mk = (i: number, cumulativeNet: number) => ({
    date: d(i),
    predictedRevenue: 5000,
    estimatedNetInflow: 4000,
    scheduledPayables: 0,
    proRatedFixedCosts: 500,
    netCashFlow: cumulativeNet,
    cumulativeNet,
  })
  return {
    storeId: "store-1",
    storeName: "Hollywood",
    horizonDays: 3,
    blendedCommissionRate: 0.13,
    proRatedFixedDaily: 500,
    totalScheduledPayables: 0,
    totalEstimatedInflow: 12000,
    endingCumulativeNet: floor,
    days: [mk(0, 1200), mk(1, floor), mk(2, floor + 400)],
  }
}

function foodCost(blendedFoodCostPct: number | null): FoodCostForecastData {
  return { blendedFoodCostPct } as FoodCostForecastData
}

function anomalies(count: number): OpenAnomaliesData {
  return {
    events: Array.from({ length: count }, (_, i) => ({
      id: `a${i}`,
      storeId: "store-1",
      target: "REVENUE" as const,
      targetId: null,
      occurredOn: d(-1 - i),
      residual: 900 - i,
      zScore: 3.4 - i,
      method: "ZSCORE" as const,
      status: "OPEN" as const,
      detectedAt: d(0),
    })),
  } as OpenAnomaliesData
}

function lostSales(total: number): LostSalesData {
  return {
    storeId: "store-1",
    storeName: "Hollywood",
    windowStart: d(-14),
    windowEnd: d(0),
    totalEstimatedLost: total,
    events: [
      {
        itemName: "Chicken Combo",
        category: "Entrees",
        storeId: "store-1",
        gapStart: d(-4),
        gapEnd: d(-2),
        gapDays: 3,
        baselineDailyQty: 12,
        meanUnitPrice: 14.5,
        estimatedLostRevenue: total,
      },
    ],
  }
}

function menuEngineering(
  rows: Array<{ itemName: string; quadrant: "STAR" | "DOG"; totalContribution: number }>,
): MenuEngineeringData {
  return {
    storeId: "store-1",
    storeName: "Hollywood",
    windowStart: d(-30),
    windowEnd: d(0),
    medianVelocity: 4,
    medianUnitMargin: 5,
    rows: rows.map((r) => ({ ...r })),
    counts: { STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0 },
    totalContribution: 0,
    coverage: {
      costedRevenue: 0,
      unmappedRevenue: 0,
      missingCostRevenue: 0,
      partialCostRevenue: 0,
      coveragePct: 100,
    },
  } as MenuEngineeringData
}

const NOTHING = {
  revenue: null,
  cash: null,
  foodCost: null,
  targetCogsPct: null,
  anomalies: null,
  lostSales: null,
  menuEngineering: null,
}

// --- cash: unreachable in production until now -------------------------------

describe("cashLine", () => {
  it("warns when the cumulative floor goes negative", () => {
    const lines = buildBriefing({ ...NOTHING, cash: cash(-2400) })
    const line = find(lines, "cash")
    expect(line).toBeDefined()
    expect(line!.severity).toBe(2)
    expect(text(line!)).toContain("-$2,400")
  })

  it("stays silent when the floor never goes negative", () => {
    expect(find(buildBriefing({ ...NOTHING, cash: cash(800) }), "cash")).toBeUndefined()
  })

  it("leads the briefing — it outranks every other line", () => {
    const lines = buildBriefing({
      ...NOTHING,
      cash: cash(-500),
      revenue: revenue(6000, 5000),
      anomalies: anomalies(3),
      lostSales: lostSales(900),
    })
    expect(lines[0]!.kind).toBe("cash")
  })
})

// --- stockouts: unreachable in production until now --------------------------

describe("stockoutLine", () => {
  it("names the item, the gap and the dollars lost", () => {
    const line = find(buildBriefing({ ...NOTHING, lostSales: lostSales(640) }), "stockout")
    expect(line).toBeDefined()
    expect(text(line!)).toContain("Chicken Combo")
    expect(text(line!)).toContain("3d")
    expect(text(line!)).toContain("$640")
  })

  it("escalates to urgent at $500 and above", () => {
    expect(find(buildBriefing({ ...NOTHING, lostSales: lostSales(500) }), "stockout")!.severity).toBe(2)
    expect(find(buildBriefing({ ...NOTHING, lostSales: lostSales(499) }), "stockout")!.severity).toBe(1)
  })
})

// --- menu: unreachable in production until now -------------------------------

describe("menuLine", () => {
  it("leads with the dog, because a dog is the actionable one", () => {
    const line = find(
      buildBriefing({
        ...NOTHING,
        menuEngineering: menuEngineering([
          { itemName: "Veggie Wrap", quadrant: "DOG", totalContribution: 40 },
          { itemName: "Family Bundle", quadrant: "STAR", totalContribution: 2100 },
        ]),
      }),
      "menu",
    )
    expect(text(line!)).toContain("Veggie Wrap")
    expect(text(line!)).not.toContain("Family Bundle")
  })

  it("falls back to the star when there is no dog", () => {
    const line = find(
      buildBriefing({
        ...NOTHING,
        menuEngineering: menuEngineering([
          { itemName: "Family Bundle", quadrant: "STAR", totalContribution: 2100 },
        ]),
      }),
      "menu",
    )
    expect(text(line!)).toContain("Family Bundle")
    expect(line!.severity).toBe(0)
  })

  it("stays silent with no rows", () => {
    expect(find(buildBriefing({ ...NOTHING, menuEngineering: menuEngineering([]) }), "menu")).toBeUndefined()
  })
})

// --- cogs: only the target-less branch was reachable in production -----------

describe("cogsLine", () => {
  it("passes no judgment when no target is set — the branch production always took", () => {
    const line = find(buildBriefing({ ...NOTHING, foodCost: foodCost(0.312) }), "cogs")
    expect(line!.severity).toBe(0)
    expect(text(line!)).toBe("Food cost forecast at 31.2%.")
  })

  it("calls out being over target, and escalates past 2 points", () => {
    const mild = find(
      buildBriefing({ ...NOTHING, foodCost: foodCost(0.30), targetCogsPct: 0.29 }),
      "cogs",
    )
    expect(mild!.severity).toBe(1)
    expect(text(mild!)).toContain("over target")

    const bad = find(
      buildBriefing({ ...NOTHING, foodCost: foodCost(0.32), targetCogsPct: 0.29 }),
      "cogs",
    )
    expect(bad!.severity).toBe(2)
  })

  it("credits being under target", () => {
    const line = find(
      buildBriefing({ ...NOTHING, foodCost: foodCost(0.27), targetCogsPct: 0.29 }),
      "cogs",
    )
    expect(line!.severity).toBe(0)
    expect(text(line!)).toContain("under target")
  })

  it("stays silent within 0.3 points of target", () => {
    expect(
      find(buildBriefing({ ...NOTHING, foodCost: foodCost(0.292), targetCogsPct: 0.29 }), "cogs"),
    ).toBeUndefined()
  })
})

// --- the whole briefing ------------------------------------------------------

describe("buildBriefing", () => {
  it("returns nothing when every input is null — the caller renders the quiet state", () => {
    expect(buildBriefing(NOTHING)).toEqual([])
  })

  it("caps at five lines even when all six generators fire", () => {
    const lines = buildBriefing({
      revenue: revenue(4000, 6000),
      cash: cash(-900),
      foodCost: foodCost(0.33),
      targetCogsPct: 0.29,
      anomalies: anomalies(4),
      lostSales: lostSales(700),
      menuEngineering: menuEngineering([
        { itemName: "Veggie Wrap", quadrant: "DOG", totalContribution: 40 },
      ]),
    })
    expect(lines).toHaveLength(5)
    expect(lines.map((l) => l.kind)).toEqual([
      "cash",
      "cogs",
      "revenue",
      "anomaly",
      "stockout",
    ])
  })

  it("qualifies the revenue line by name on the portfolio view", () => {
    const solo = find(buildBriefing({ ...NOTHING, revenue: revenue(6000, 5000) }), "revenue")
    const all = find(
      buildBriefing({ ...NOTHING, revenue: revenue(6000, 5000), isAggregate: true }),
      "revenue",
    )
    expect(text(solo!)).toContain("Revenue trends")
    expect(text(all!)).toContain("Portfolio revenue trends")
  })
})
