import { describe, expect, it } from "vitest"
import { buildPlain, fixedNotOnFile, slices, type PlainStoreFile } from "@/lib/counter/pnl-plain"
import { soldDaysWithoutLabor, type StoreLaborCost } from "@/lib/counter/labor-cost-core"
import type { Statement, StatementLines, StoreStatement } from "@/lib/counter/statement"
import type { CommissionTotals } from "@/lib/counter/commission-core"
import { primeCost } from "@/lib/counter/prime-cost"

const commission = (orders: number, estimated: number): CommissionTotals =>
  ({
    amount: 0,
    recorded: 0,
    estimated: 0,
    orders,
    ordersRecorded: orders - estimated,
    ordersEstimated: estimated,
    unknownOrders: 0,
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

function statement(stores: StoreStatement[], periods: Statement["periods"] = [], periodLines?: StatementLines[]): Statement {
  const sum = (k: keyof StatementLines) => stores.reduce((a, s) => a + (s[k] as number), 0)
  const l = lines({
    sales: sum("grossSales"),
    fees: sum("commissions"),
    food: sum("cogsValue"),
    labor: sum("laborValue"),
    fixed: sum("occupancy"),
    laborMissingDays: sum("laborMissingDays"),
    commission: commission(200, 150),
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
    expect(p.atMost).toBe("at most · 2 Glendale days of labor missing")
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
      "App fees are mostly estimated",
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
