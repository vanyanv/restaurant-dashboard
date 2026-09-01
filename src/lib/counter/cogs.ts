import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"

/**
 * The cost of goods for a window: its category split, and the items losing
 * the most against plan.
 *
 * ## C-R1 — the central ruling, and the one this whole module exists for
 *
 * `DailyCogsItem` carries a `salesRevenue` column sitting right beside
 * `lineCost`. Dividing one by the other is the obvious move and it is WRONG
 * for the page's headline figure. Measured on the live database, window
 * 2026-08-20 … 26, Hollywood:
 *
 *   cost $14,008 / `DailyCogsItem.salesRevenue` summed ($66,985)  = 20.91%
 *   cost $14,008 / the statement's Total Sales ($49,389)          = 28.36%
 *
 * The Analytics store page already ships 27.8% for that same week, off the
 * statement's own COGS rollup line. A COGS page built on the obvious column
 * would print 20.9% while a page three clicks away prints 27.8% — seven and
 * a half points apart, both labelled "food cost". This project has fixed the
 * identical defect four times in two days (the labour percent, the SPLH
 * denominator, a twelve-week trend, a strip caption) — it is the defect
 * family this codebase is most prone to, and food cost IS this page.
 *
 * **So: `sales` is a PARAMETER.** `cogsWindow` and `loadCogs` take it in,
 * off the statement the adapter already loaded (`TOTAL_SALES_CODE` on the
 * P&L, the same figure `statement.ts` reads and `labor-week.ts`'s
 * `salesByDay`/`weeklyTotalSales` already follow this exact contract for).
 * `DailyCogsItem.salesRevenue` is NEVER a denominator for the window's
 * `foodPct` — not summed, not read — anywhere in this module. A loader that
 * derived its own sales from the cost table would be a second answer to a
 * question the page already answered, and it would be the WRONG answer by
 * 7.5 points, not a rounding difference.
 *
 * **This does not apply to a single item's own `foodPct`.** `CogsItem`
 * ranks individual menu items against each other, and there is no
 * statement-level "Total Sales" for one item to divide by — the statement
 * has exactly one Total Sales line, for the whole store. An item's own
 * `salesRevenue` (its menu revenue) is the only revenue figure that exists
 * at item grain, so `cogsItem` uses it on purpose. The ruling above is about
 * the WINDOW'S headline percentage — the number printed once, in one place,
 * that must agree with the same window's figure on the Analytics page — not
 * about a per-item ranking metric that has no statement counterpart to
 * agree or disagree with.
 *
 * ## The restaurant is UNDER plan — this inverts the prototype's whole frame
 *
 * `Store.targetCogsPct` is 30 for Hollywood; the measured statement-basis
 * food cost is 28.36%. `againstPlan` is **-1.64** — negative, meaning inside
 * plan, which is the good direction here. The prototype this page is modeled
 * on assumes an overshoot ("the red is the overshoot, not the measure") and
 * a table of "items costing the most against plan" — built for a restaurant
 * running OVER. Ours runs under. Signs are never made absolute anywhere in
 * this module: a negative `againstPlan` must stay negative all the way to
 * the caller, or "under plan" silently becomes indistinguishable from "over
 * plan by the same amount".
 *
 * ## Nulls
 *
 * - `CogsWindow.foodPct` is `null` with no sales — never `0` (a percent of
 *   zero or negative sales is not a food-cost percentage, it is a division
 *   nobody asked for; `> 0`, not `!== 0`, guards the same way
 *   `labor-week.ts`'s `pctOfSales` does).
 * - `CogsItem.foodPct` is `null` with no revenue AND with no cost. "Zero" is
 *   not a fallback value here — a real menu item never truly costs nothing
 *   to make, so a `0` in this column would be read as "this item is free",
 *   which is not a claim this module is in a position to make from a
 *   missing or zeroed-out cost row. Only a genuinely positive cost over a
 *   genuinely positive revenue produces a percentage.
 * - `CogsItem.againstPlan` is `null` whenever `foodPct` or `plan` is
 *   unknown — never computed against a stand-in plan.
 * - `CogsItem.lost` is `null` for any item at or under plan. `rankByLoss`
 *   drops those items entirely rather than ranking them at `0`, which would
 *   put "exactly on plan" ahead of "no data" in a sorted list for no reason
 *   tied to either one.
 *
 * ## Scoping
 *
 * Stores are resolved through `accountId` FIRST — `prisma.store.findMany({
 * where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) }
 * })` — exactly as `channel-mix.ts` and `labor-week.ts` do: without it,
 * `storeId: null` means every store in the database, not every store on
 * this account. This module deliberately does NOT import `@/lib/auth` —
 * that pulls `@/lib/prisma` in at MODULE LOAD, which throws without
 * `DATABASE_URL` and takes every importer down with it, tests included. The
 * page already has an `accountId` from its own session lookup.
 *
 * `plan` is `Store.targetCogsPct` when every selected store agrees on one
 * value, `null` otherwise — the same `agreedTarget` rule `targets.ts` uses
 * for the strip meter, for the identical reason: a plan drawn from two
 * stores' average is a number no operator ever set.
 */

export interface CogsCategory {
  category: string
  cost: number
  /** Share of the window's category cost, 0..100. Categories sum to 100. */
  share: number
}

export interface CogsItem {
  itemName: string
  cost: number
  revenue: number
  units: number
  /** This item's cost over ITS OWN revenue, 0..100. `null` with no revenue
   *  OR no cost — see the module note on why a zero cost is never printed
   *  as a real percentage. */
  foodPct: number | null
  /** Points above the plan, or `null` where either side is unknown. */
  againstPlan: number | null
  /** What the overshoot costs, in dollars. `null` when inside plan. */
  lost: number | null
}

/**
 * One calendar day's cost, keyed the way a `@db.Date` column reads back.
 *
 * `day` is `date.toISOString().slice(0, 10)` — the same `dbDay` construct
 * `labor-week.ts` and `staffing-curve.ts` already use for their own date
 * columns, and the same string `date-range.ts`'s `isoDay(localDate)`
 * produces for the same calendar day. That pairing is the whole point: the
 * adapter walks the range in LOCAL days and looks each one up here, exactly
 * as `salesByDayOf` does against the statement.
 *
 * Days with no row are ABSENT rather than zero. A day the materialiser has
 * not reached is not a day that cost nothing, and the chart draws a gap for
 * it rather than a plunge to the axis.
 */
export interface CogsDay {
  /** `YYYY-MM-DD`. */
  day: string
  cost: number
}

/**
 * The invoices that have not reached the cost above — `Invoice.status`
 * `REVIEW`.
 *
 * DELIBERATELY NOT BOUNDED BY THE PAGE'S RANGE. An invoice sitting in review
 * is a backlog, not a reading of a window: it is money the ingredient prices
 * behind `lineCost` have not seen yet, whenever it arrived. Scoping it to a
 * seven-day range would print "0 waiting" on a page whose costs are stale by
 * a month of unposted paper. Measured 2026-08-27: 13 invoices worth $19,627
 * across the whole table, against the prototype's invented "3 · $2,140".
 *
 * `oldest` is the earliest `invoiceDate` among them, so the caller can say
 * how long the backlog has been standing rather than only how big it is.
 */
export interface UnpostedInvoices {
  count: number
  /** Sum of `totalAmount`. Returns and credit memos are stored negative and net out here. */
  total: number
  oldest: Date | null
}

export interface CogsWindow {
  cost: number
  /** THE STATEMENT'S Total Sales. Never `DailyCogsItem.salesRevenue` (C-R1). */
  sales: number
  /** `cost / sales * 100`. `null` with no sales — never `0`. */
  foodPct: number | null
  plan: number | null
  /** `foodPct - plan`; negative is inside plan, which is where this store sits. */
  againstPlan: number | null
  categories: CogsCategory[]
  /** Lines whose cost is an understatement — `partialCost`. */
  partialLines: number
  unmappedLines: number
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/** `cost / sales * 100`, `null` with no positive sales — never `0`. */
function pctOfSales(cost: number, sales: number): number | null {
  return sales > 0 ? (cost / sales) * 100 : null
}

/**
 * An item's own food-cost ratio, 0..100. `null` unless BOTH sides are
 * genuinely positive — see the module note: a zeroed-out or missing cost is
 * never printed as "0% food cost", because that reads as "this item costs
 * nothing to make", which a missing cost row is not evidence of.
 */
function itemFoodPct(cost: number, revenue: number): number | null {
  return cost > 0 && revenue > 0 ? (cost / revenue) * 100 : null
}

/** `foodPct - plan`, `null` when either side is unknown. Never absolute-valued. */
function pointsAbovePlan(foodPct: number | null, plan: number | null): number | null {
  return foodPct === null || plan === null ? null : foodPct - plan
}

/**
 * The dollar cost of an overshoot: `againstPlan` points of `revenue`.
 * `null` at or under plan (`againstPlan <= 0`) — an item inside plan has not
 * "lost" a negative amount, it has lost nothing, which is a `null`, not a
 * negative dollar figure nobody would read as a loss.
 */
function overageDollars(againstPlan: number | null, revenue: number): number | null {
  return againstPlan === null || againstPlan <= 0 ? null : (againstPlan / 100) * revenue
}

/**
 * The window: total cost against the statement's sales, the category split,
 * and the plan comparison. Pure — every dollar figure is handed in by the
 * caller (`loadCogs`), which is what keeps this testable without mocking
 * Prisma (this task's rule).
 */
export function cogsWindow(input: {
  cost: number
  /** THE STATEMENT'S Total Sales (C-R1) — see the module note. */
  sales: number
  plan: number | null
  categories: Array<{ category: string; cost: number }>
  partialLines: number
  unmappedLines: number
}): CogsWindow {
  const foodPct = pctOfSales(input.cost, input.sales)
  const againstPlan = pointsAbovePlan(foodPct, input.plan)

  const totalCategoryCost = sum(input.categories.map((c) => c.cost))
  const categories: CogsCategory[] = [...input.categories]
    .sort((a, b) => b.cost - a.cost)
    .map((c) => ({
      category: c.category,
      cost: c.cost,
      share: totalCategoryCost > 0 ? (c.cost / totalCategoryCost) * 100 : 0,
    }))

  return {
    cost: input.cost,
    sales: input.sales,
    foodPct,
    plan: input.plan,
    againstPlan,
    categories,
    partialLines: input.partialLines,
    unmappedLines: input.unmappedLines,
  }
}

/**
 * One item, off its own aggregated cost/revenue/units. Not in the brief's
 * export list, but pulled out and exported for the same reason
 * `labor-week.ts` exports `laborRole`: assertion 5 ("an item with revenue
 * and no cost yields `foodPct: null`, never `0`") is otherwise untestable
 * under this task's rule that `loadCogs` is not unit-tested and Prisma is
 * not mocked.
 */
export function cogsItem(input: {
  itemName: string
  cost: number
  revenue: number
  units: number
  plan: number | null
}): CogsItem {
  const foodPct = itemFoodPct(input.cost, input.revenue)
  const againstPlan = pointsAbovePlan(foodPct, input.plan)
  const lost = overageDollars(againstPlan, input.revenue)

  return {
    itemName: input.itemName,
    cost: input.cost,
    revenue: input.revenue,
    units: input.units,
    foodPct,
    againstPlan,
    lost,
  }
}

/**
 * The items losing the most against a plan, largest `lost` first.
 *
 * Recomputes `againstPlan`/`lost` from each item's own `foodPct` against
 * THIS `plan` argument, rather than trusting whatever `againstPlan`/`lost`
 * the item already carries. That is deliberate, not redundant: `cogsItem`'s
 * own `plan` can be `null` (no agreed plan across the selected stores) even
 * though a caller here has a concrete number to rank against, and a second
 * `loadCogs` caller could reasonably want the SAME items array ranked
 * against a different plan than the one baked into it. Recomputing here
 * keeps `rankByLoss` self-sufficient rather than silently returning `[]`
 * whenever the items array happened to be built with `plan: null`.
 *
 * Items at or under plan are dropped — `lost: null` — never ranked as `0`;
 * see the module note on why `0` is never a stand-in for "no loss".
 */
export function rankByLoss(items: CogsItem[], plan: number): CogsItem[] {
  return items
    .map((item) => {
      const againstPlan = pointsAbovePlan(item.foodPct, plan)
      const lost = overageDollars(againstPlan, item.revenue)
      return { ...item, againstPlan, lost }
    })
    .filter((item): item is CogsItem & { lost: number } => item.lost !== null)
    .sort((a, b) => b.lost - a.lost)
}

/**
 * The account-wide food-cost plan, when the selected stores agree on one —
 * the identical rule `targets.ts`'s (unexported) `agreedTarget` uses, and
 * for the identical reason: a plan drawn from two stores' average (28% and
 * 31% averaging to 29.5%) is a number no operator ever set. Not imported
 * from `targets.ts` because that helper is module-private; three lines
 * duplicated here is cheaper than exporting it across a module boundary for
 * a single caller.
 */
function agreedPlan(values: Array<number | null>): number | null {
  const set = new Set(values.filter((v): v is number => v != null))
  return set.size === 1 ? [...set][0] : null
}

/**
 * The range's cost of goods, queried.
 *
 * ONE query against `DailyCogsItem` answers both the window (cost, category
 * split, partial/unmapped line counts) and the item list — the same rows
 * fold both ways, so a category total and an item total built from them can
 * never disagree about what happened to a given line.
 */
export async function loadCogs(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  /** THE STATEMENT'S Total Sales, off the statement the adapter already
   *  loaded (C-R1). Never derived here from `DailyCogsItem`. */
  sales: number
}): Promise<{ window: CogsWindow; items: CogsItem[]; byDay: CogsDay[] }> {
  const { range, storeId, accountId, sales } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  // A storeId that is not on this account resolves to no stores, not to the
  // whole account (same rule as `loadChannelMix`/`loadLaborWeek`).
  if (stores.length === 0) {
    return {
      window: cogsWindow({
        cost: 0,
        sales,
        plan: null,
        categories: [],
        partialLines: 0,
        unmappedLines: 0,
      }),
      items: [],
      byDay: [],
    }
  }
  const storeIds = stores.map((s) => s.id)
  const plan = agreedPlan(stores.map((s) => s.targetCogsPct))

  const rows = await prisma.dailyCogsItem.findMany({
    where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
    select: {
      date: true,
      itemName: true,
      category: true,
      salesRevenue: true,
      lineCost: true,
      qtySold: true,
      status: true,
      partialCost: true,
    },
  })

  let cost = 0
  let partialLines = 0
  let unmappedLines = 0
  const categoryCost = new Map<string, number>()
  const itemAgg = new Map<string, { cost: number; revenue: number; units: number }>()
  const dayCost = new Map<string, number>()

  for (const r of rows) {
    cost += r.lineCost
    if (r.partialCost) partialLines += 1
    if (r.status === "UNMAPPED") unmappedLines += 1

    categoryCost.set(r.category, (categoryCost.get(r.category) ?? 0) + r.lineCost)
    // `dbDay`: a `@db.Date` column reads back as UTC midnight, so the ISO
    // slice is the calendar day the row was written for. Never local getters
    // here — west of Greenwich they name the previous day.
    const day = r.date.toISOString().slice(0, 10)
    dayCost.set(day, (dayCost.get(day) ?? 0) + r.lineCost)

    const bucket = itemAgg.get(r.itemName) ?? { cost: 0, revenue: 0, units: 0 }
    bucket.cost += r.lineCost
    bucket.revenue += r.salesRevenue
    bucket.units += r.qtySold
    itemAgg.set(r.itemName, bucket)
  }

  const window = cogsWindow({
    cost,
    sales,
    plan,
    categories: [...categoryCost.entries()].map(([category, catCost]) => ({
      category,
      cost: catCost,
    })),
    partialLines,
    unmappedLines,
  })

  const items = [...itemAgg.entries()].map(([itemName, agg]) =>
    cogsItem({ itemName, cost: agg.cost, revenue: agg.revenue, units: agg.units, plan }),
  )

  const byDay: CogsDay[] = [...dayCost.entries()]
    .map(([day, dCost]) => ({ day, cost: dCost }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return { window, items, byDay }
}

/**
 * The unposted-invoice backlog (C-R6). One aggregate, account-scoped first
 * for the same reason `loadCogs` resolves stores before it reads a cost row.
 *
 * A `storeId` narrows to that store's invoices. `Invoice.storeId` is
 * nullable, so an invoice the sync could not attribute to a store is counted
 * on the group page and not on any store page — which is the truthful
 * answer, and the caller's `meta` says so rather than quietly folding
 * unattributed paper into whichever store the reader happens to be on.
 */
export async function loadUnpostedInvoices(input: {
  storeId: string | null
  accountId: string
}): Promise<UnpostedInvoices> {
  const { storeId, accountId } = input

  const where = {
    accountId,
    status: "REVIEW" as const,
    ...(storeId ? { storeId } : {}),
  }

  const [agg, oldest] = await Promise.all([
    prisma.invoice.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.findFirst({
      where: { ...where, invoiceDate: { not: null } },
      orderBy: { invoiceDate: "asc" },
      select: { invoiceDate: true },
    }),
  ])

  return {
    count: agg._count._all,
    total: agg._sum.totalAmount ?? 0,
    oldest: oldest?.invoiceDate ?? null,
  }
}
