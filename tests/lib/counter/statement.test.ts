/**
 * The statement reduction's contract.
 *
 * `src/lib/counter/statement.ts` is the ONE place a Counter surface turns
 * `getAllStoresPnL` into the cascade an owner reads — gross, commissions,
 * food, labour, occupancy, other, bottom line. The Overview and the P&L both
 * print those dollars, so the thing these tests pin is not the arithmetic of
 * any single line but the SHAPE of the load: one call, one set of bounds, one
 * rollup, and a single store read OUT of the all-stores answer rather than
 * fetched again with bounds of its own.
 *
 * Note 60 — prime cost reading 56.2% on one page and 57.9% on the other — was
 * a formula difference, and `prime-cost.ts` closed that. These tests close the
 * two ways it could come back WITHOUT a formula difference: a second query with
 * different bounds, and a rollup that answers for a different set of stores.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Imports `@/lib/prisma` at module load, which throws without a DATABASE_URL.
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))

import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  granularityFor,
  loadStatement,
  type Statement,
} from "@/lib/counter/statement"

const mockPnL = vi.mocked(getAllStoresPnL)

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const accountId = "acct_1"

/** Two daily buckets, 2026-08-18 → 2026-08-19. */
const range: DateRange = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 19) }

function rows() {
  return [
    { code: "TOTAL_SALES", label: "Total Sales", values: [4000, 3468], percents: [1, 1] },
    { code: "6100", label: "Cost of Goods Sold", values: [-1200, -1000], percents: [-0.3, -0.288] },
    { code: "6200", label: "Labor", values: [-1000, -900], percents: [-0.25, -0.26] },
  ]
}

const periods = [
  { label: "Tue Aug 18", startDate: range.start, endDate: range.start, days: 1, isPartial: false },
  { label: "Wed Aug 19", startDate: range.end, endDate: range.end, days: 1, isPartial: false },
]

/**
 * One store's KPIs, exactly the shape `getAllStoresPnL` publishes.
 *
 * `fixedCosts` is labour + rent + towels + cleaning + custom, which is why
 * `otherOperating` is the remainder and not a field of its own.
 */
function kpis(over: Partial<Record<string, number>> = {}) {
  const base = {
    grossSales: 7468,
    netAfterCommissions: 7000,
    fixedCosts: 2600, // 1900 labour + 500 rent + 200 of towels/cleaning
    bottomLine: 2200, // 7468 − 468 commissions − 2200 cogs − 2600 fixed
    marginPct: 2200 / 7468,
    cogsValue: 2200,
    cogsPct: 2200 / 7468,
    laborValue: 1900,
    laborPct: 1900 / 7468,
    rentValue: 500,
    rentPct: 500 / 7468,
  }
  return { ...base, ...over }
}

function store(id: string, name: string, over: Partial<Record<string, number>> = {}) {
  return {
    storeId: id,
    storeName: name,
    ...kpis(over),
    channelMix: [],
    fixedCostsConfigured: true,
    rows: rows(),
  }
}

function rollup(over: Record<string, unknown> = {}) {
  return {
    storeCount: 1,
    combined: kpis(),
    perStore: [store("holly", "Hollywood")],
    consolidatedRows: rows(),
    periods,
    ...over,
  }
}

function load(over: Partial<Parameters<typeof loadStatement>[0]> = {}): Promise<Statement> {
  return loadStatement({ range, storeId: null, accountId, ...over })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPnL.mockResolvedValue(rollup() as never)
})

/* ── Granularity ──────────────────────────────────────────────────────── */

describe("granularityFor", () => {
  const span = (days: number): DateRange => ({
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, days),
  })

  it("buckets a month or less by day", () => {
    expect(granularityFor(span(1))).toBe("daily")
    expect(granularityFor(span(31))).toBe("daily")
  })

  it("buckets up to four months by week", () => {
    expect(granularityFor(span(32))).toBe("weekly")
    expect(granularityFor(span(123))).toBe("weekly")
  })

  it("buckets anything longer by month", () => {
    expect(granularityFor(span(124))).toBe("monthly")
  })
})

/* ── One call, one set of bounds ──────────────────────────────────────── */

describe("loadStatement — the shape of the load", () => {
  it("asks the rollup exactly once, whatever the scope", async () => {
    await load()
    expect(mockPnL).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockPnL.mockResolvedValue(rollup() as never)
    await load({ storeId: "holly" })
    // The single-store figure is READ OUT of the all-stores answer. A second
    // call here is the bounds difference note 60 came back through.
    expect(mockPnL).toHaveBeenCalledTimes(1)
  })

  it("passes the range's own inclusive query bounds", async () => {
    await load()
    const bounds = toQueryBounds(range)
    expect(mockPnL).toHaveBeenCalledWith({
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      granularity: "daily",
    })
  })

  it("takes an explicit granularity over the one its own range implies", async () => {
    // This is what keeps a comparison window on the SELECTED range's buckets.
    // A four-week `weekday` window derives "weekly" from itself, and a weekly
    // comparison drawn against daily bars is a chart comparing two things.
    await load({ granularity: "daily", range: { start: new Date(2026, 0, 1), end: new Date(2026, 2, 1) } })
    expect(mockPnL).toHaveBeenCalledWith(expect.objectContaining({ granularity: "daily" }))
  })

  it("throws with the rollup's own message, so a refusal reaches the reader", async () => {
    mockPnL.mockResolvedValue({ error: "P&L is restricted to owners" } as never)
    await expect(load()).rejects.toThrow("P&L is restricted to owners")
  })

  it("counts the days of the range it was asked for", async () => {
    const s = await load()
    expect(s.days).toBe(2)
  })

  it("carries the rollup's own rows and periods through", async () => {
    const s = await load()
    expect(s.rows).toEqual(rollup().consolidatedRows)
    expect(s.periods).toEqual(periods)
  })
})

/* ── The cascade ──────────────────────────────────────────────────────── */

describe("loadStatement — the lines", () => {
  it("reads commissions as gross less net-after-commissions, positive", async () => {
    const s = await load()
    expect(s.commissions).toBe(468)
  })

  it("takes occupancy from the rollup's own rent line", async () => {
    const s = await load()
    expect(s.occupancy).toBe(500)
  })

  it("takes other operating as the remainder of fixed costs after labour and rent", async () => {
    const s = await load()
    expect(s.otherOperating).toBe(200)
  })

  it("clamps other operating at zero rather than printing -$0.00", async () => {
    // fixedCosts is labour + rent + the rest, summed period by period. When
    // there IS no rest, the remainder is a float subtraction of two numbers
    // that are equal in theory and 1e-12 apart in practice — and a cascade of
    // positive subtractions renders that as "-$0.00".
    const drifted = kpis({ fixedCosts: 1900 + 500 - 1e-12 })
    mockPnL.mockResolvedValue(rollup({ combined: drifted, perStore: [store("holly", "Hollywood")] }) as never)
    const s = await load()
    expect(s.otherOperating).toBe(0)
    expect(Object.is(s.otherOperating, -0)).toBe(false)
  })

  it("subtracts to the bottom line the rollup states — the five lines and the sixth agree", async () => {
    const s = await load()
    const cascade =
      s.grossSales - s.commissions - s.cogsValue - s.laborValue - s.occupancy - s.otherOperating
    expect(cascade).toBeCloseTo(s.bottomLine, 6)
  })
})

/* ── marginPct ────────────────────────────────────────────────────────── */

describe("loadStatement — marginPct", () => {
  it("passes the rollup's margin through when there are sales", async () => {
    const s = await load()
    expect(s.marginPct).toBeCloseTo(2200 / 7468, 10)
  })

  it("is null with no sales, never 0", async () => {
    // Zero reads as break-even — a pre-open store spending on fit-out with no
    // revenue would print "0.0% margin", which is a score rather than an
    // absence. `format.ts` prints null as an em-dash.
    const flat = kpis({ grossSales: 0, netAfterCommissions: 0, marginPct: 0, bottomLine: -400 })
    mockPnL.mockResolvedValue(rollup({ combined: flat, perStore: [store("holly", "Hollywood", flat)] }) as never)
    const s = await load()
    expect(s.marginPct).toBeNull()
    expect(s.perStore[0].marginPct).toBeNull()
  })

  it("is null when the denominator is negative, for the same reason", async () => {
    // A range of pure refunds divides by a negative and prints a large
    // positive margin, which reads as a triumph. Same rule `primeCost` states.
    const refunds = kpis({ grossSales: -300, netAfterCommissions: -300, marginPct: 1.5, bottomLine: -450 })
    mockPnL.mockResolvedValue(rollup({ combined: refunds }) as never)
    const s = await load()
    expect(s.marginPct).toBeNull()
  })
})

/* ── Scoping ──────────────────────────────────────────────────────────── */

describe("loadStatement — scope", () => {
  const two = () =>
    rollup({
      storeCount: 2,
      combined: kpis({
        grossSales: 10000,
        netAfterCommissions: 9400,
        fixedCosts: 3400,
        bottomLine: 3200,
        marginPct: 3200 / 10000,
        cogsValue: 2600,
        cogsPct: 2600 / 10000,
        laborValue: 2500,
        laborPct: 2500 / 10000,
        rentValue: 700,
        rentPct: 700 / 10000,
      }),
      perStore: [
        store("holly", "Hollywood"),
        store("gln", "Glendale", {
          grossSales: 2532,
          netAfterCommissions: 2400,
          fixedCosts: 800,
          bottomLine: 1000,
          marginPct: 1000 / 2532,
          cogsValue: 400,
          cogsPct: 400 / 2532,
          laborValue: 600,
          laborPct: 600 / 2532,
          rentValue: 200,
          rentPct: 200 / 2532,
        }),
      ],
    })

  it("answers for the whole account when no store is selected", async () => {
    mockPnL.mockResolvedValue(two() as never)
    const s = await load()
    expect(s.grossSales).toBe(10000)
    expect(s.perStore.map((p) => p.storeId)).toEqual(["holly", "gln"])
    expect(s.storeNotFound).toBe(false)
  })

  it("reads a single store OUT of the all-stores answer, labour total included", async () => {
    // `getStorePnL` publishes no labour TOTAL — labour is one PnLRow among
    // twenty — so a single-store view that called it would have to re-derive
    // the figure the group total already has. This is why the scope is a
    // lookup rather than a second query.
    mockPnL.mockResolvedValue(two() as never)
    const s = await load({ storeId: "gln" })
    expect(s.grossSales).toBe(2532)
    expect(s.laborValue).toBe(600)
    expect(s.cogsValue).toBe(400)
    expect(s.occupancy).toBe(200)
    expect(s.perStore.map((p) => p.storeId)).toEqual(["gln"])
    expect(s.storeNotFound).toBe(false)
  })

  it("takes the selected store's own rows, not the consolidated ones", async () => {
    const detail = [{ code: "TOTAL_SALES", label: "Total Sales", values: [1266, 1266], percents: [1, 1] }]
    const r = two()
    r.perStore[1] = { ...r.perStore[1], rows: detail }
    mockPnL.mockResolvedValue(r as never)
    const s = await load({ storeId: "gln" })
    expect(s.rows).toEqual(detail)
  })

  it("says so, rather than falling back to the account, when the store is not in the rollup", async () => {
    mockPnL.mockResolvedValue(two() as never)
    const s = await load({ storeId: "nobody" })
    expect(s.storeNotFound).toBe(true)
    expect(s.grossSales).toBe(0)
    expect(s.marginPct).toBeNull()
    expect(s.perStore).toEqual([])
  })

  it("sums its per-store lines to its own headline (note 39)", async () => {
    mockPnL.mockResolvedValue(two() as never)
    const s = await load()
    const sum = (f: (p: Statement["perStore"][number]) => number) =>
      s.perStore.reduce((t, p) => t + f(p), 0)
    expect(sum((p) => p.grossSales)).toBeCloseTo(s.grossSales, 6)
    expect(sum((p) => p.cogsValue)).toBeCloseTo(s.cogsValue, 6)
    expect(sum((p) => p.laborValue)).toBeCloseTo(s.laborValue, 6)
    expect(sum((p) => p.occupancy)).toBeCloseTo(s.occupancy, 6)
    expect(sum((p) => p.bottomLine)).toBeCloseTo(s.bottomLine, 6)
  })

  it("carries each store's fixed-cost configuration flag", async () => {
    const r = two()
    r.perStore[1] = { ...r.perStore[1], fixedCostsConfigured: false }
    mockPnL.mockResolvedValue(r as never)
    const s = await load()
    expect(s.perStore.map((p) => p.fixedCostsConfigured)).toEqual([true, false])
  })
})

/* ── Prime ────────────────────────────────────────────────────────────── */

describe("loadStatement — prime", () => {
  it("comes from prime-cost.ts, on the statement's own denominator", async () => {
    const s = await load()
    expect(s.prime.primeValue).toBe(2200 + 1900)
    expect(s.prime.ceilingPct).toBe(PRIME_CEILING_PCT)
    expect(s.prime.primePct).toBeCloseTo(54.9, 1)
  })

  it("gives every store its own, on that store's denominator", async () => {
    const s = await load()
    expect(s.perStore[0].prime.primeValue).toBe(4100)
  })

  it("withholds every percentage when there is no denominator", async () => {
    const flat = kpis({ grossSales: 0, netAfterCommissions: 0, marginPct: 0, cogsValue: 0, cogsPct: 0, laborValue: 0, laborPct: 0 })
    mockPnL.mockResolvedValue(rollup({ combined: flat }) as never)
    const s = await load()
    expect(s.prime.primePct).toBeNull()
    expect(s.prime.overCeiling).toBe(false)
  })
})
