import { describe, expect, it } from "vitest"
import { buildPlain, fixedNotOnFile, slices, upperBoundCauses, type PlainStoreFile } from "@/lib/counter/pnl-plain"
import { trailingWeeks } from "@/lib/counter/date-range"
import { soldDaysWithoutLabor, type StoreLaborCost } from "@/lib/counter/labor-cost-core"
import type { Statement, StatementLines, StoreStatement } from "@/lib/counter/statement"
import type { CommissionTotals } from "@/lib/counter/commission-core"
import { primeCost } from "@/lib/counter/prime-cost"

const commission = (orders: number, estimated: number, unknown = 0): CommissionTotals =>
  ({
    amount: 0,
    recorded: 0,
    estimated: 0,
    orders,
    ordersRecorded: orders - estimated - unknown,
    ordersEstimated: estimated,
    unknownOrders: unknown,
    ordersFromSales: 0,
  }) as unknown as CommissionTotals

function lines(o: Partial<StatementLines> & { sales: number; fees: number; food: number; labor: number; fixed: number }): StatementLines {
  const bottom = o.sales - o.fees - o.food - o.labor - o.fixed
  return {
    grossSales: o.sales,
    salesBeforeDiscounts: o.sales,
    discounts: 0,
    refunds: 0,
    taxCollected: 0,
    commissions: o.fees,
    commission: o.commission ?? commission(100, 20),
    cogsValue: o.food,
    laborValue: o.labor,
    occupancy: o.fixed,
    otherOperating: 0,
    bottomLine: bottom,
    marginPct: o.sales > 0 ? bottom / o.sales : null,
    cogsPct: o.sales > 0 ? o.food / o.sales : 0,
    laborPct: o.sales > 0 ? o.labor / o.sales : 0,
    laborMissingDays: o.laborMissingDays ?? 0,
    laborEstimatedDays: o.laborEstimatedDays ?? 0,
    cogsMissingDays: o.cogsMissingDays ?? 0,
    uncostedSales: o.uncostedSales ?? 0,
  }
}

function storeSt(id: string, name: string, l: StatementLines, periodLines?: StatementLines[]): StoreStatement {
  return {
    ...l,
    storeId: id,
    storeName: name,
    fixedCostsConfigured: true,
    prime: primeCost({ grossSales: l.grossSales, cogsValue: l.cogsValue, laborValue: l.laborValue }),
    rows: [],
    periodLines,
  }
}

function statement(
  stores: StoreStatement[],
  periods: Statement["periods"] = [],
  periodLines?: StatementLines[],
  comm: CommissionTotals = commission(200, 150),
): Statement {
  const sum = (k: keyof StatementLines) => stores.reduce((a, s) => a + (s[k] as number), 0)
  const l = lines({
    sales: sum("grossSales"),
    fees: sum("commissions"),
    food: sum("cogsValue"),
    labor: sum("laborValue"),
    fixed: sum("occupancy"),
    laborMissingDays: sum("laborMissingDays"),
    laborEstimatedDays: sum("laborEstimatedDays"),
    cogsMissingDays: sum("cogsMissingDays"),
    uncostedSales: sum("uncostedSales"),
    commission: comm,
  })
  return {
    ...l,
    days: 7,
    prime: primeCost({ grossSales: l.grossSales, cogsValue: l.cogsValue, laborValue: l.laborValue }),
    perStore: stores,
    allStores: stores,
    storeNotFound: false,
    rows: [],
    periods,
    periodLines,
  }
}

const files: PlainStoreFile[] = [
  { id: "h", name: "Chris N Eddys - Hollywood", fixedMonthlyRent: 10390, fixedMonthlyCleaning: 3400, fixedMonthlyTowels: 238 },
  { id: "g", name: "Chris N Eddys - Glendale", fixedMonthlyRent: 9000, fixedMonthlyCleaning: null, fixedMonthlyTowels: null },
]

const day = (iso: string) => ({ label: iso, startDate: new Date(`${iso}T00:00:00Z`), endDate: new Date(`${iso}T00:00:00Z`), days: 1, isPartial: false })

describe("soldDaysWithoutLabor", () => {
  const store = { byDay: { "2026-10-30": { amount: 1, wages: 1, source: "daily" } } } as unknown as StoreLaborCost
  const periods = [day("2026-10-29"), day("2026-10-30"), day("2026-10-31")]

  it("counts only the days the store SOLD with no labor reading", () => {
    const sold = new Set(["2026-10-29", "2026-10-30"])
    expect(soldDaysWithoutLabor(store, sold, periods)).toEqual([1, 0, 0])
  })

  it("counts nothing for a store whose fixed labor budget fills its gaps", () => {
    expect(soldDaysWithoutLabor(store, new Set(["2026-10-29"]), periods, true)).toEqual([0, 0, 0])
  })

  it("counts every sold day when Harri has nothing for the store", () => {
    expect(soldDaysWithoutLabor(undefined, new Set(["2026-10-29", "2026-10-31"]), periods)).toEqual([1, 0, 1])
  })
})

describe("buildPlain", () => {
  const holly = storeSt("h", "Chris N Eddys - Hollywood", lines({ sales: 48000, fees: 6800, food: 11400, labor: 10800, fixed: 3200 }))
  const glen = storeSt("g", "Chris N Eddys - Glendale", lines({ sales: 9700, fees: 400, food: 2600, labor: 950, fixed: 2100, laborMissingDays: 2 }))
  const s = statement([holly, glen])
  const prior = statement([
    storeSt("h", "Chris N Eddys - Hollywood", lines({ sales: 47300, fees: 6700, food: 11700, labor: 9200, fixed: 3200 })),
  ])

  const p = buildPlain({ statement: s, prior, priorLabel: "Oct 19 – 25", weekWindows: [], weeks: null, daily: null, files, storeId: null })

  it("reads kept off the statement's own bottom line, never recomputing it", () => {
    expect(p.kept).toBe(s.bottomLine)
    const sl = slices(s)
    expect(sl.fees + sl.food + sl.labor + sl.fixed + sl.kept).toBeCloseTo(s.grossSales)
  })

  it("calls the figure an upper bound when a store sold with no labor, and says whose", () => {
    expect(p.atMost).toBe("at most · 2 Glendale days of labor missing · 2 fixed costs not on file")
    expect(p.statuses.find((x) => x.text.startsWith("Labor"))).toEqual({ tone: "bad", text: "Labor: 2 store-days missing" })
    expect(p.sentence).toContain("true number is lower")
  })

  it("compares against the prior period in dollars and points", () => {
    expect(p.vsPrior?.label).toBe("Oct 19 – 25")
    expect(p.vsPrior?.kept).toBeCloseTo(s.bottomLine - prior.bottomLine)
  })

  it("names fixed costs that are not on file instead of printing them as $0", () => {
    expect(fixedNotOnFile(files).map((n) => `${n.store} ${n.what}`)).toEqual(["Glendale cleaning", "Glendale towels"])
    const todo = p.todos.find((t) => t.title === "Fill in store settings")
    expect(todo?.items[0]).toBe("Not on file: Glendale cleaning and Glendale towels.")
    expect(todo?.action.href).toBe("/dashboard/stores/g")
  })

  it("never reads a store list that did not load as 'all on file'", () => {
    const q = buildPlain({ statement: s, prior: null, priorLabel: null, weekWindows: [], weeks: null, daily: null, files: [], storeId: null })
    expect(q.statuses.find((x) => x.text.startsWith("Fixed"))).toEqual({ tone: "warn", text: "Fixed costs: store settings did not load" })
  })

  it("groups the gaps into at most three to-dos", () => {
    expect(p.todos.map((t) => t.title)).toEqual([
      "Labor is missing",
      "Fill in store settings",
      "App fees are estimated",
    ])
  })

  it("lists every day of a daily load, never calling an at-most day the best", () => {
    const periods = [day("2026-10-26"), day("2026-10-27")]
    const d1 = lines({ sales: 9000, fees: 1300, food: 2300, labor: 2300, fixed: 760 })
    const d2 = lines({ sales: 9800, fees: 1400, food: 2500, labor: 2400, fixed: 760, laborMissingDays: 1 })
    const daily = statement(
      [
        storeSt("h", "Chris N Eddys - Hollywood", d1, [d1, lines({ sales: 9000, fees: 1300, food: 2300, labor: 2300, fixed: 460 })]),
        storeSt("g", "Chris N Eddys - Glendale", d2, [lines({ sales: 0, fees: 0, food: 0, labor: 0, fixed: 300 }), lines({ sales: 800, fees: 100, food: 200, labor: 0, fixed: 300, laborMissingDays: 1 })]),
      ],
      periods,
      [d1, d2],
    )
    const q = buildPlain({ statement: s, prior: null, priorLabel: null, weekWindows: [], weeks: null, daily, files, storeId: null })
    expect(q.days?.map((d) => d.label)).toEqual(["Mon 10/26", "Tue 10/27"])
    expect(q.days?.[1].laborMissing).toEqual(["Glendale"])
    expect(q.days?.[1].atMost).toBe(true)
    // The at-most day is higher, but only because its labor is missing.
    expect(q.days?.some((d) => d.best && d.atMost)).toBe(false)
  })

  it("leaves days out when the range was not read daily", () => {
    expect(p.days).toBeNull()
  })
})

describe("buildPlain: every input counted as $0 makes the figure an upper bound", () => {
  const allOnFile: PlainStoreFile[] = [
    { id: "h", name: "Chris N Eddys - Hollywood", fixedMonthlyRent: 10390, fixedMonthlyCleaning: 3400, fixedMonthlyTowels: 238 },
  ]
  const run = (o: Partial<StatementLines>, comm = commission(100, 0), f = allOnFile) => {
    const st = storeSt("h", "Chris N Eddys - Hollywood", lines({ sales: 10_000, fees: 1000, food: 2500, labor: 2500, fixed: 1000, commission: comm, ...o }))
    return buildPlain({ statement: statement([st], [], undefined, comm), prior: null, priorLabel: null, weekWindows: [], weeks: null, daily: null, files: f, storeId: null })
  }

  it("is whole only when every input is a reading", () => {
    const q = run({})
    expect(q.atMost).toBeNull()
    expect(q.keptNote).toBeNull()
    expect(q.statuses.every((x) => x.tone === "ok")).toBe(true)
    expect(q.statuses.map((x) => x.text)).toContain("Food: from your recipes")
    expect(q.statuses.map((x) => x.text)).toContain("Labor: every day from Harri")
    expect(q.statuses.map((x) => x.text)).toContain("App fees: from the apps")
    expect(q.stores[0].atMost).toBe(false)
  })

  it("a fixed cost not on file", () => {
    const q = run({}, commission(100, 0), [{ ...allOnFile[0], fixedMonthlyTowels: null }])
    expect(q.atMost).toBe("at most · 1 fixed cost not on file")
    expect(q.sentence).toContain("Some costs are not on file, so the true number is lower.")
    expect(q.stores[0].atMost).toBe(true)
  })

  it("store settings that did not load", () => {
    expect(run({}, commission(100, 0), []).atMost).toBe("at most · store settings did not load")
  })

  it("sales on items with no recipe or unpriced ingredients", () => {
    const q = run({ uncostedSales: 1_200 })
    expect(q.atMost).toBe("at most · 12% of sales not fully costed")
    expect(q.statuses).toContainEqual({ tone: "warn", text: "Food: 12% of sales not fully costed" })
    expect(q.statuses.map((x) => x.text)).not.toContain("Food: from your recipes")
    expect(q.lines.find((l) => l.key === "food")).toMatchObject({ how: "12% of sales not fully costed", tone: "warn" })
    expect(q.todos.map((t) => t.title)).toContain("Food cost is incomplete")
    expect(q.gaps.uncostedShare).toBeCloseTo(0.12)
  })

  it("says a sliver of uncosted sales instead of rounding it to 0%", () => {
    expect(run({ uncostedSales: 20 }).atMost).toBe("at most · under 1% of sales not fully costed")
  })

  it("days that sold with no recipe-cost rows at all", () => {
    const q = run({ cogsMissingDays: 2 })
    expect(q.atMost).toBe("at most · 2 days with no food cost")
    expect(q.statuses).toContainEqual({ tone: "bad", text: "Food: 2 store-days with no food cost" })
    expect(q.todos.find((t) => t.title === "Food cost is incomplete")?.tone).toBe("bad")
  })

  it("app orders with no fee and no rate on file, never called worked out from rates", () => {
    const q = run({}, commission(100, 0, 7))
    expect(q.atMost).toBe("at most · 7 app orders with no fee")
    expect(q.statuses).toContainEqual({ tone: "bad", text: "App fees: 7 orders with no fee and no rate on file" })
    expect(q.statuses.some((x) => /rates/.test(x.text))).toBe(false)
    expect(q.lines.find((l) => l.key === "fees")?.tone).toBe("bad")
    expect(q.todos.find((t) => t.title === "App fees are missing")?.tone).toBe("bad")
  })

  it("labor filled from the budget is an estimate, said as one, never 'from Harri'", () => {
    const q = run({ laborEstimatedDays: 3 })
    expect(q.atMost).toBeNull()
    expect(q.keptNote).toBe("estimated · 3 days of labor estimated from your labor budget")
    expect(q.statuses).toContainEqual({ tone: "warn", text: "Labor: 3 days estimated from your labor budget" })
    expect(q.statuses.map((x) => x.text)).not.toContain("Labor: every day from Harri")
    expect(q.lines.find((l) => l.key === "labor")).toMatchObject({ how: "3 days estimated from your labor budget", tone: "warn" })
    expect(q.lines.find((l) => l.key === "kept")?.how).toBe("estimated")
    expect(q.stores[0].flags).toContain("3 days of labor estimated")
  })

  it("adds what is estimated after what is missing on the line beside the figure", () => {
    const q = run({ laborEstimatedDays: 1, uncostedSales: 500 })
    expect(q.keptNote).toBe("at most · 5% of sales not fully costed · 1 day of labor estimated from your labor budget")
  })

  it("calls app fees estimated past 10% at the store's rates, and fine at or under it", () => {
    const high = run({}, commission(100, 15))
    expect(high.statuses).toContainEqual({ tone: "warn", text: "App fees: 15% estimated from your rates" })
    expect(high.keptNote).toBe("estimated · 15% of app fees estimated from your rates")
    expect(high.atMost).toBeNull()
    const low = run({}, commission(100, 10))
    expect(low.statuses).toContainEqual({ tone: "ok", text: "App fees: mostly from the apps" })
    expect(low.keptNote).toBeNull()
  })

  it("names every cause, and upperBoundCauses is the one judge of a bare statement", () => {
    const l = lines({ sales: 100, fees: 0, food: 0, labor: 0, fixed: 0, laborMissingDays: 1, cogsMissingDays: 1, uncostedSales: 10, commission: commission(10, 0, 1) })
    expect(upperBoundCauses(l)).toEqual(["1 day of labor missing", "1 day with no food cost", "10% of sales not fully costed", "1 app order with no fee"])
    expect(upperBoundCauses(lines({ sales: 100, fees: 0, food: 0, labor: 0, fixed: 0, commission: commission(10, 0) }))).toEqual([])
  })
})

describe("buildPlain: the eight weeks", () => {
  const windows = trailingWeeks(new Date("2026-11-19T12:00:00"), 2)
  const full = lines({ sales: 9000, fees: 900, food: 2000, labor: 2000, fixed: 700, commission: commission(10, 0) })
  const gap = lines({ sales: 5000, fees: 500, food: 1000, labor: 1000, fixed: 400, uncostedSales: 300, commission: commission(10, 0) })
  const s = statement([storeSt("h", "Chris N Eddys - Hollywood", full)])
  const q = buildPlain({
    statement: s,
    prior: null,
    priorLabel: null,
    weekWindows: windows,
    weeks: [full, gap].map((l) => ({ ...s, ...l })),
    daily: null,
    files,
    storeId: null,
  })

  it("carries the running week through, so it can say 'so far'", () => {
    expect(q.weeks.map((w) => w.running)).toEqual([false, true])
  })

  it("marks a week at most on any gap of its own, not only labor", () => {
    expect(q.weeks.map((w) => w.atMost)).toEqual([false, true])
  })
})
