// cogsWindow / cogsItem / rankByLoss — the cost-of-goods window, against
// "COGS — measured before anything is built" in
// .superpowers/sdd/2026-08-27-counter-cogs-fidelity/task-1-brief.md, window
// 2026-08-20 … 2026-08-26, Hollywood.
//
// Every figure below is an INDEPENDENTLY measured number off that note —
// cost $14,008, the statement's Total Sales $49,389, `DailyCogsItem`'s own
// summed `salesRevenue` $66,985, the eight menu-category dollar figures, and
// `Store.targetCogsPct` 30. None of them is derived from an expected output
// (the defect an earlier task in this project shipped: a fixture built as
// `splh * hours` that could not fail regardless of which sales source the
// code actually read). Every `expect(...)` here is arithmetic performed ON
// those measured inputs, not a restatement of an input already fed in.
import { describe, it, expect, vi } from "vitest"

// `cogs.ts` imports `@/lib/prisma` for `loadCogs`. That import throws
// without `DATABASE_URL` at MODULE LOAD. This file never calls `loadCogs`
// (loaders are not unit-tested, per this task's rule — no mocked Prisma);
// the mock only keeps the import graph from crashing at load time, same
// pattern as `tests/lib/counter/labor-week.test.ts`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { cogsItem, cogsWindow, rankByLoss, type CogsItem } from "@/lib/counter/cogs"

/* ── The measured window, 2026-08-20 … 2026-08-26 ────────────────────── */

const COST = 14008
const STATEMENT_SALES = 49389 // the statement's Total Sales — the ONLY legal denominator (C-R1)
const MENU_REVENUE = 66985 // `DailyCogsItem.salesRevenue` summed — C-R1 FORBIDS this as the window's denominator
const PLAN = 30 // Store.targetCogsPct, Hollywood

const CATEGORIES = [
  { category: "On The Side", cost: 4063 },
  { category: "NFL Promo", cost: 3227 },
  { category: "Combos", cost: 3033 },
  { category: "Slider and Fries Combos", cost: 1644 },
  { category: "Drinks", cost: 993 },
  { category: "Packaging", cost: 370 },
  { category: "Secret Menu", cost: 366 },
  { category: "A La Carte", cost: 313 },
]

describe("cogsWindow — the measured window", () => {
  it("assertion 1: foodPct on the statement's Total Sales is 28.36", () => {
    const window = cogsWindow({
      cost: COST,
      sales: STATEMENT_SALES,
      plan: PLAN,
      categories: CATEGORIES,
      partialLines: 6,
      unmappedLines: 0,
    })
    expect(window.foodPct).not.toBeNull()
    expect(window.foodPct as number).toBeCloseTo(28.36, 2)
  })

  it("assertion 2 (C-R1): the menu-revenue denominator gives 20.91 — the number this module must never print for the window", () => {
    const wrong = cogsWindow({
      cost: COST,
      sales: MENU_REVENUE, // DailyCogsItem.salesRevenue summed — forbidden by C-R1
      plan: PLAN,
      categories: CATEGORIES,
      partialLines: 6,
      unmappedLines: 0,
    })
    // 20.91 is not a rounding neighbour of 28.36 — it is the WRONG figure,
    // reachable only by feeding the wrong sales source in. Naming it here
    // pins down exactly what C-R1 forbids: `cogsWindow` never reaches for
    // this number on its own, because `sales` only ever arrives as a
    // parameter (never summed off `DailyCogsItem` inside this module).
    expect(wrong.foodPct as number).toBeCloseTo(20.91, 2)
    expect(wrong.foodPct as number).not.toBeCloseTo(28.36, 1)
  })

  it("assertion 3: againstPlan on a plan of 30 is -1.64 — negative, inside plan", () => {
    const window = cogsWindow({
      cost: COST,
      sales: STATEMENT_SALES,
      plan: PLAN,
      categories: CATEGORIES,
      partialLines: 6,
      unmappedLines: 0,
    })
    expect(window.againstPlan).not.toBeNull()
    expect(window.againstPlan as number).toBeCloseTo(-1.64, 2)
    expect(window.againstPlan as number).toBeLessThan(0)
  })

  it("assertion 4: category shares sum to 100 and sort cost-descending, On The Side first at 29.0%", () => {
    const window = cogsWindow({
      cost: COST,
      sales: STATEMENT_SALES,
      plan: PLAN,
      categories: CATEGORIES,
      partialLines: 6,
      unmappedLines: 0,
    })
    const totalShare = window.categories.reduce((a, c) => a + c.share, 0)
    expect(totalShare).toBeCloseTo(100, 2)

    expect(window.categories[0].category).toBe("On The Side")
    expect(window.categories[0].share).toBeCloseTo(29.0, 1)

    const costs = window.categories.map((c) => c.cost)
    const sorted = [...costs].sort((a, b) => b - a)
    expect(costs).toEqual(sorted)
  })

  it("assertion 7: a window with no sales yields foodPct null and no NaN anywhere", () => {
    const window = cogsWindow({
      cost: COST,
      sales: 0,
      plan: PLAN,
      categories: CATEGORIES,
      partialLines: 0,
      unmappedLines: 0,
    })
    expect(window.foodPct).toBeNull()
    expect(window.againstPlan).toBeNull()
    for (const c of window.categories) {
      expect(Number.isNaN(c.share)).toBe(false)
    }
    expect(Number.isNaN(window.cost)).toBe(false)
  })
})

describe("cogsItem", () => {
  it("assertion 5: an item with revenue and no cost yields foodPct: null, never 0", () => {
    const item = cogsItem({ itemName: "Fries", cost: 0, revenue: 500, units: 40, plan: PLAN })
    expect(item.foodPct).toBeNull()
    expect(item.foodPct).not.toBe(0)
    expect(item.againstPlan).toBeNull()
    expect(item.lost).toBeNull()
  })

  it("computes a real ratio when both cost and revenue are positive", () => {
    const item = cogsItem({ itemName: "Wings", cost: 400, revenue: 1000, units: 50, plan: PLAN })
    expect(item.foodPct).toBeCloseTo(40, 5)
    expect(item.againstPlan).toBeCloseTo(10, 5)
    expect(item.lost).toBeCloseTo(100, 5) // 10 pts of $1000
  })
})

describe("rankByLoss", () => {
  it("assertion 6: ranks the largest lost first and drops items inside plan (lost: null), not as zero", () => {
    // Built with plan: null on purpose — rankByLoss must recompute against
    // ITS OWN plan argument rather than trusting whatever plan (if any) the
    // items were originally built with.
    const items: CogsItem[] = [
      cogsItem({ itemName: "Over A", cost: 400, revenue: 1000, units: 10, plan: null }), // 40% -> +10pts -> $100 lost
      cogsItem({ itemName: "Inside", cost: 200, revenue: 1000, units: 10, plan: null }), // 20% -> -10pts -> inside plan
      cogsItem({ itemName: "Over B", cost: 350, revenue: 700, units: 10, plan: null }), // 50% -> +20pts -> $140 lost
      cogsItem({ itemName: "No data", cost: 0, revenue: 500, units: 10, plan: null }), // foodPct null
    ]

    const ranked = rankByLoss(items, PLAN)

    expect(ranked.map((i) => i.itemName)).toEqual(["Over B", "Over A"])
    expect(ranked[0].lost as number).toBeCloseTo(140, 5)
    expect(ranked[1].lost as number).toBeCloseTo(100, 5)
    // Inside-plan and no-data items are dropped entirely, not ranked as 0.
    expect(ranked.find((i) => i.itemName === "Inside")).toBeUndefined()
    expect(ranked.find((i) => i.itemName === "No data")).toBeUndefined()
  })
})
