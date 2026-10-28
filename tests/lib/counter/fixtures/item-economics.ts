/**
 * The one fixture every per-item money test shares.
 *
 * A buy-one-get-one slider, an ordinary side, an item nothing has costed and a
 * packaging row — the four shapes that made per-item figures disagree across
 * the menu pages before `src/lib/counter/item-economics.ts` existed:
 *
 *   - "Signature Slider" rings up 100 × $13.49 = $1,349 and the deal takes half
 *     back, so it COLLECTS $674.50 against $155 of booked cost: 22.98% food
 *     cost on what was collected, 11.49% on the rung-up price.
 *   - "Fries" sells 50 at $5 with no deal: $75 of cost, 30% food cost.
 *   - "Mystery Item" is UNMAPPED — real revenue at $0 cost. It must never read
 *     as 0% food cost or 100% margin.
 *   - "Packaging - medium" holds cost against no revenue and is not an item.
 *
 * `cogsGroupBy` stands in for `prisma.dailyCogsItem.groupBy` the way the
 * database would answer it, honouring `by`, the filters the adapters use and
 * `_sum`/`_count`, so each test exercises the real fold rather than a canned
 * aggregate.
 */
import type { ItemDiscountEntry } from "@/lib/counter/item-discounts"

export interface FixtureCogsRow {
  storeId: string
  date: Date
  itemName: string
  category: string
  recipeId: string | null
  status: "COSTED" | "UNMAPPED" | "MISSING_COST"
  qtySold: number
  salesRevenue: number
  lineCost: number
  partialCost: boolean
  costSource: string | null
}

const DAY = new Date("2026-10-01T00:00:00Z")

export function cogsRow(over: Partial<FixtureCogsRow> & Pick<FixtureCogsRow, "itemName">): FixtureCogsRow {
  return {
    storeId: "s1",
    date: DAY,
    category: "Menu",
    recipeId: `r-${over.itemName}`,
    status: "COSTED",
    qtySold: 0,
    salesRevenue: 0,
    lineCost: 0,
    partialCost: false,
    costSource: "invoice",
    ...over,
  }
}

export const SLIDER = "Signature Slider"
export const FRIES = "Fries"
export const MYSTERY = "Mystery Item"

export const BOGO_ROWS: FixtureCogsRow[] = [
  // Two store-days, so a fold that only reads the first row is caught.
  cogsRow({ itemName: SLIDER, category: "Sliders", recipeId: "r_slider", qtySold: 60, salesRevenue: 809.4, lineCost: 93 }),
  cogsRow({ itemName: SLIDER, category: "Sliders", recipeId: "r_slider", qtySold: 40, salesRevenue: 539.6, lineCost: 62, date: new Date("2026-10-02T00:00:00Z") }),
  cogsRow({ itemName: FRIES, category: "Sides", recipeId: "r_fries", qtySold: 50, salesRevenue: 250, lineCost: 75 }),
  cogsRow({ itemName: MYSTERY, category: "Uncategorized", recipeId: null, status: "UNMAPPED", qtySold: 10, salesRevenue: 100, lineCost: 0, costSource: null }),
  cogsRow({ itemName: "Packaging - medium", category: "Packaging", recipeId: null, qtySold: 150, salesRevenue: 0, lineCost: 30, costSource: null }),
]

/** What `getItemDiscounts` reports for the fixture: half the slider came back off. */
export function bogoDiscounts(): Map<string, ItemDiscountEntry> {
  return new Map([
    [
      SLIDER,
      {
        gross: 1349,
        discount: 674.5,
        byPlatform: new Map([["ubereats", { gross: 1349, discount: 674.5 }]]),
        byStore: new Map([["s1", { gross: 1349, discount: 674.5 }]]),
      },
    ],
    [
      FRIES,
      {
        gross: 250,
        discount: 0,
        byPlatform: new Map([["ubereats", { gross: 250, discount: 0 }]]),
        byStore: new Map([["s1", { gross: 250, discount: 0 }]]),
      },
    ],
  ])
}

/** Booked cost over collected, 0..100 — the slider's true food cost. */
export const SLIDER_FOOD_COST = (155 / 674.5) * 100
/** What the rung-up price implied, and what no page may print any more. */
export const SLIDER_FOOD_COST_PRE_DISCOUNT = (155 / 1349) * 100
/** `menuMargin` over the fixture: costed items, Packaging out, after discounts. */
export const FIXTURE_MENU_MARGIN = 100 - ((155 + 75) / (674.5 + 250)) * 100

type Where = Record<string, unknown>

function matches(row: FixtureCogsRow, where: Where | undefined): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === "storeId" || key === "date" || key === "store") continue
    const value = (row as unknown as Record<string, unknown>)[key]
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; in?: unknown[] }
      if ("not" in c && value === c.not) return false
      if (Array.isArray(c.in) && !c.in.includes(value)) return false
    } else if (cond !== undefined && value !== cond) {
      return false
    }
  }
  if (where.storeId && typeof where.storeId === "object") {
    const ids = (where.storeId as { in?: string[] }).in
    if (ids && !ids.includes(row.storeId)) return false
  }
  return true
}

/** A `dailyCogsItem.groupBy` that answers the way Postgres would over `rows`. */
export function cogsGroupBy(rows: FixtureCogsRow[]) {
  return async (args: {
    by: string[]
    where?: Where
    _sum?: Record<string, boolean>
    _count?: unknown
  }) => {
    const groups = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      if (!matches(r, args.where)) continue
      const key = JSON.stringify(args.by.map((k) => (r as unknown as Record<string, unknown>)[k]))
      const g =
        groups.get(key) ??
        Object.fromEntries([
          ...args.by.map((k) => [k, (r as unknown as Record<string, unknown>)[k]]),
          ["_sum", { qtySold: 0, salesRevenue: 0, lineCost: 0 }],
          ["_count", { _all: 0 }],
        ])
      const sum = g._sum as Record<string, number>
      sum.qtySold += r.qtySold
      sum.salesRevenue += r.salesRevenue
      sum.lineCost += r.lineCost
      ;(g._count as { _all: number })._all += 1
      groups.set(key, g)
    }
    return [...groups.values()]
  }
}

/** A `dailyCogsItem.findMany` over `rows`, honouring the same filters. */
export function cogsFindMany(rows: FixtureCogsRow[]) {
  return async (args: { where?: Where } = {}) => rows.filter((r) => matches(r, args.where))
}

/** A `dailyCogsItem.aggregate` over `rows`. */
export function cogsAggregate(rows: FixtureCogsRow[]) {
  return async (args: { where?: Where } = {}) => {
    const hit = rows.filter((r) => matches(r, args.where))
    return {
      _sum: {
        qtySold: hit.reduce((t, r) => t + r.qtySold, 0),
        salesRevenue: hit.reduce((t, r) => t + r.salesRevenue, 0),
        lineCost: hit.reduce((t, r) => t + r.lineCost, 0),
      },
    }
  }
}
