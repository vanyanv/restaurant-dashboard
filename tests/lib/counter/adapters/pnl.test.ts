/**
 * The P&L adapter's contract.
 *
 * Three things these tests exist to catch, in order of how expensive they were
 * the last time they happened:
 *
 * 1. **A percentage read at the wrong scale.** `Statement.cogsPct` is a
 *    FRACTION and `WeekRow.cogsPct` is POINTS. A fraction carried straight
 *    through prints "0.3%" for a 31.4% week and clears every target on the
 *    page — a healthy-looking P&L whose units are wrong, which is note 60's
 *    own defect class one field over.
 * 2. **Prime cost re-derived.** Any `cogs + labor` over `gross` in this
 *    adapter is a second definition. `tests/lib/counter/note-60.test.ts`
 *    covers the cross-page half; the tests here cover it within the page.
 * 3. **A figure invented to fill a section.** The trust panel and the food
 *    causes have no data behind them, so they are owed and say what is
 *    missing; the labour band exists nowhere in this schema, so the labour
 *    cell is bare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Every one of these imports `@/lib/prisma` at module load, which throws
// without a DATABASE_URL — the same reason the adapter takes an accountId
// rather than fetching its own session.
vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn() }))
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))
vi.mock("@/lib/counter/channel-mix", () => ({ loadChannelMix: vi.fn() }))
vi.mock("@/lib/counter/targets", () => ({ loadStripTargets: vi.fn() }))

import { getStores } from "@/app/actions/store/crud-actions"
import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import { loadChannelMix } from "@/lib/counter/channel-mix"
import { loadStripTargets } from "@/lib/counter/targets"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import { toQueryBounds, trailingWeeks } from "@/lib/counter/date-range"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { isJudged, type Reference } from "@/lib/counter/bullet-state"
import {
  getPnlSections,
  type PnlSections,
  type StatementLine,
  type StripCell,
} from "@/lib/counter/adapters/pnl"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const accountId = "acct_1"
/** A Monday-to-Sunday week, so the comparison windows are clean. */
const range = { start: new Date(2026, 7, 17), end: new Date(2026, 7, 23) }
/** A Tuesday, so the eighth week is a two-day part-week. */
const today = new Date(2026, 7, 25)

/**
 * Note 60's own figures: food 31.4%, labour 24.8%, prime 56.2%.
 *
 * Chosen so a wrong-scale reading is unmistakable (0.3% against 31.4%) and so
 * the prime figure is the one the note is about.
 */
const GROSS = 152_400
const COGS = 47_853.6 // 31.4%
const LABOR = 37_795.2 // 24.8%
const RENT = 5_600
const OTHER = 1_400
const COMMISSIONS = 18_288
const FIXED = LABOR + RENT + OTHER
const BOTTOM = GROSS - COMMISSIONS - COGS - LABOR - RENT - OTHER

function kpis(over: Partial<Record<string, number>> = {}) {
  return {
    grossSales: GROSS,
    netAfterCommissions: GROSS - COMMISSIONS,
    fixedCosts: FIXED,
    bottomLine: BOTTOM,
    marginPct: BOTTOM / GROSS,
    cogsValue: COGS,
    cogsPct: COGS / GROSS,
    laborValue: LABOR,
    laborPct: LABOR / GROSS,
    rentValue: RENT,
    rentPct: RENT / GROSS,
    ...over,
  }
}

const rows = () => [
  { code: "TOTAL_SALES", label: "Total Sales", values: [GROSS], percents: [1] },
]

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

/** Hollywood trades; Glendale is on the account and has never opened. */
const EMPTY_STORE = {
  grossSales: 0,
  netAfterCommissions: 0,
  fixedCosts: 0,
  bottomLine: 0,
  marginPct: 0,
  cogsValue: 0,
  cogsPct: 0,
  laborValue: 0,
  laborPct: 0,
  rentValue: 0,
  rentPct: 0,
}

/**
 * A rollup answer.
 *
 * `perPeriod` mirrors `combined`, once per period — which is what the real
 * rollup produces for a fixture whose every period holds the same figures, and
 * what the eight-weeks table now reads. Passing `periods` through from the
 * call lets the fixture answer an eight-period request with eight entries, the
 * way the real one does, instead of one.
 */
function rollup(over: Record<string, unknown> = {}) {
  const base = {
    storeCount: 2,
    combined: kpis(),
    perStore: [store("holly", "Hollywood"), store("gln", "Glendale", EMPTY_STORE)],
    consolidatedRows: rows(),
    periods: [
      { label: "Week", startDate: range.start, endDate: range.end, days: 7, isPartial: false },
    ],
    ...over,
  }
  return {
    ...base,
    perPeriod:
      (over.perPeriod as unknown[]) ??
      (base.periods as unknown[]).map(() => base.combined),
  }
}

/** The default mock: answers with one perPeriod entry per period asked for. */
function rollupFor(arg: { periods?: unknown[] }, over: Record<string, unknown> = {}) {
  return arg.periods
    ? rollup({ ...over, periods: arg.periods })
    : rollup(over)
}

const HOLLY = {
  id: "holly",
  name: "Hollywood",
  lifecycleStage: "ready",
  openedAt: new Date(2024, 0, 1),
  fixedMonthlyRent: 24_000,
  fixedMonthlyLabor: 40_000,
  targetCogsPct: 29,
  isActive: true,
}
const GLENDALE = {
  id: "gln",
  name: "Glendale",
  lifecycleStage: "pre_open",
  openedAt: null,
  fixedMonthlyRent: null,
  fixedMonthlyLabor: 30_000,
  targetCogsPct: null,
  isActive: true,
}

const NO_TARGETS = {
  orders: null,
  ticket: null,
  foodCost: null,
  labor: null,
  prime: null,
  marketplaceFees: null,
}
const FOOD_TARGET = { ...NO_TARGETS, foodCost: { kind: "target", value: 29, better: "low" } }

const CHANNELS = [
  { channel: "house", net: 60_000, orders: 2_400, commission: 0, ticket: 25 },
  { channel: "doordash", net: 52_400, orders: 2_000, commission: 12_000, ticket: 26.2 },
  { channel: "grubhub", net: 40_000, orders: 1_600, commission: null, ticket: 25 },
]

function happyPath() {
  vi.mocked(getStores).mockResolvedValue([HOLLY, GLENDALE] as never)
  vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { periods?: unknown[] }) =>
    rollupFor(arg)) as never)
  vi.mocked(loadChannelMix).mockResolvedValue(CHANNELS as never)
  vi.mocked(loadStripTargets).mockResolvedValue(FOOD_TARGET as never)
}

const load = (over: Partial<Parameters<typeof getPnlSections>[0]> = {}) =>
  getPnlSections({ range, storeId: null, accountId, today, ...over })

/** The data of a section that must have loaded, or a failure that names it. */
function must<T>(sd: SectionData<T>, what: string): T {
  if (!hasData(sd)) throw new Error(`${what} is ${sd.status}, not ready`)
  return sd.data
}

const cellOf = (s: PnlSections, label: string): StripCell | undefined =>
  must(s.headline, "headline").cells.find((c) => c.label === label)

const lineOf = (s: PnlSections, key: string): StatementLine | undefined =>
  must(s.statement, "statement").lines.find((l) => l.key === key)

/** The reading paragraph as one string, for assertions about what it says. */
const reads = (s: PnlSections) =>
  must(s.headline, "headline")
    .reading.map((r) => r.text)
    .join("")

beforeEach(() => {
  vi.clearAllMocks()
  happyPath()
})

/* ── The shape of the load ────────────────────────────────────────────── */

describe("getPnlSections — the loads", () => {
  it("loads the selected range once and ALL eight weeks in one more call", async () => {
    await load()
    // Was 9 — the selected range plus one rollup per week. The eight weeks are
    // now a single call carrying eight explicit periods, which is the whole of
    // what `loadWeekStatements` changed.
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(2)
  })

  it("adds exactly one more window when a comparison is chosen", async () => {
    await load({ comparisonId: "prev" })
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(3)
  })

  it("asks each week for the bounds the page will use when that row is pressed", async () => {
    await load()
    const weeks = trailingWeeks(today, 8)
    const asked = vi.mocked(getAllStoresPnL).mock.calls.map((c) => c[0])
    // The promise a week row makes is that its figures are the figures the
    // page shows when that row is pressed. That used to be kept by asking for
    // each week's exact bounds in its own call; it is now kept by asking for
    // them as explicit PERIODS in one call. Same promise, one round trip —
    // and the bounds are still asserted, because a period whose boundaries
    // drifted would label a row with one week and fill it with another.
    const weeksCall = asked.find((a) => a.periods)
    expect(weeksCall, "no call carried explicit week periods").toBeTruthy()
    const periods = weeksCall!.periods!
    expect(periods).toHaveLength(8)
    for (const [i, w] of weeks.entries()) {
      const bounds = toQueryBounds({ start: w.start, end: w.end })
      expect(periods[i].startDate.getTime()).toBe(bounds.startDate.getTime())
      expect(periods[i].endDate.getTime()).toBe(bounds.endDate.getTime())
    }
  })

  it("holds the comparison window to the SELECTED range's granularity", async () => {
    // A `weekday` window contains four occurrences and would derive "weekly"
    // from itself — a comparison of two different things.
    await load({ comparisonId: "weekday" })
    // Only the calls that let the rollup BUCKET for them. The eight-weeks call
    // states its periods outright, so its `granularity` is ignored and saying
    // anything about it here would be asserting a value nothing reads.
    const inferred = vi
      .mocked(getAllStoresPnL)
      .mock.calls.map(([arg]) => arg)
      .filter((arg) => !arg.periods)
    expect(inferred.length).toBeGreaterThan(0)
    for (const arg of inferred) {
      expect(arg.granularity).toBe("daily")
    }
  })
})

/* ── The unit trap ────────────────────────────────────────────────────── */

describe("percentages are points, not fractions", () => {
  it("prints each week's rates at the scale `WeekRow` documents", async () => {
    const s = await load()
    const week = must(s.weeks, "weeks").rows[0]
    // 0.314 would print "0.3%" and clear every target on the page forever.
    expect(week.cogsPct).toBeCloseTo(31.4, 1)
    expect(week.laborPct).toBeCloseTo(24.8, 1)
    expect(week.primePct).toBeCloseTo(56.2, 1)
    expect(week.marginPct).toBeCloseTo((BOTTOM / GROSS) * 100, 1)
  })

  it("prints the strip's rates at the same scale", async () => {
    const s = await load()
    expect(cellOf(s, "Food")?.value).toBe("31.4%")
    expect(cellOf(s, "Labor")?.value).toBe("24.8%")
    expect(cellOf(s, "Prime cost")?.value).toBe("56.2%")
  })

  it("prints the statement's shares at the same scale", async () => {
    const s = await load()
    expect(lineOf(s, "food")?.share).toBe("31.4%")
    expect(lineOf(s, "prime")?.share).toBe("56.2%")
    expect(lineOf(s, "bottom")?.share).toBe(`${((BOTTOM / GROSS) * 100).toFixed(1)}%`)
  })

  it("keeps every week's own figures on its own denominator", async () => {
    const s = await load()
    const rowsOut = must(s.weeks, "weeks").rows
    expect(rowsOut).toHaveLength(8)
    for (const w of rowsOut) expect(w.primePct).toBeCloseTo(56.2, 1)
  })
})

/* ── Prime cost is not re-derived ─────────────────────────────────────── */

describe("prime cost", () => {
  it("is judged against the ceiling `prime-cost.ts` owns, and nothing restates it", async () => {
    const s = await load()
    const cell = cellOf(s, "Prime cost")
    expect(cell?.reference?.target).toBe(PRIME_CEILING_PCT)
    expect(cell?.caption).toBe(`Ceiling ${PRIME_CEILING_PCT.toFixed(1)}%`)
  })

  it("is withheld — cell, week and store alike — when no labour is posted against sales", async () => {
    // Zero labour over a range with sales is a store whose labour is neither
    // clocked nor budgeted. "0.0%" would be the same lie as a $0 commission.
    const noLabor = { ...kpis(), laborValue: 0, laborPct: 0 }
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { periods?: unknown[] }) =>
      rollupFor(arg, {
        combined: noLabor,
        perStore: [{ ...store("holly", "Hollywood"), ...noLabor }],
      })) as never)
    const s = await load()
    expect(cellOf(s, "Prime cost")).toBeUndefined()
    expect(cellOf(s, "Labor")).toBeUndefined()
    expect(must(s.weeks, "weeks").rows[0].primePct).toBeNull()
    expect(must(s.byStore, "byStore").find((x) => x.id === "holly")?.primePct).toBeNull()
    // And the reading says so rather than quietly dropping the sentence.
    expect(reads(s)).toContain("no labor is posted")
  })
})

/* ── Nothing is invented ──────────────────────────────────────────────── */

describe("absences", () => {
  it("owes the trust panel, naming the two things that do not exist", async () => {
    const s = await load()
    expect(s.trust.status).toBe("not_computed")
    if (s.trust.status !== "not_computed") throw new Error("unreachable")
    expect(s.trust.owed).toMatch(/provenance/)
    expect(s.trust.owed).toMatch(/unposted/)
  })

  it("owes the food-cause decomposition, naming what a cause would need", async () => {
    const s = await load()
    expect(s.foodCause.status).toBe("not_computed")
    if (s.foodCause.status !== "not_computed") throw new Error("unreachable")
    expect(s.foodCause.owed).toMatch(/attribution/)
  })

  it("draws no meter on labour, because this schema publishes no labour band", async () => {
    const s = await load()
    // The prototype's 23.9–26.2% "plus salaried" exists nowhere but the
    // prototype. `isJudged` is `lo != null || target != null` — the labour
    // cell carries neither, so `Figure` draws no bullet.
    //
    // NOT `reference === undefined`, which is what this asserted before the
    // sparklines landed. A reference is also how a figure carries its
    // TRAJECTORY, and the two are independent: throwing the reference away to
    // avoid a band threw the eight weeks away with it. What must stay absent
    // is the JUDGEMENT, and that is what this now says.
    const labor = cellOf(s, "Labor")?.reference
    expect(labor).toBeDefined()
    expect(isJudged(labor as Reference)).toBe(false)
    expect(labor?.target).toBeUndefined()
    expect(labor?.lo).toBeUndefined()
    expect(labor?.hi).toBeUndefined()
    // These two carry no reference at all — no band and no spark, exactly as
    // the prototype leaves them.
    expect(cellOf(s, "Bottom line")?.reference).toBeUndefined()
    expect(cellOf(s, "Gross sales")?.reference).toBeUndefined()
  })

  it("draws no meter on food either when the store has set no target", async () => {
    vi.mocked(loadStripTargets).mockResolvedValue(NO_TARGETS as never)
    const s = await load()
    const food = cellOf(s, "Food")?.reference
    expect(isJudged(food as Reference)).toBe(false)
    expect(food?.target).toBeUndefined()
    expect(cellOf(s, "Food")?.caption).toBeUndefined()
    expect(must(s.weeks, "weeks").foodTargetPct).toBeNull()
    // And it does not claim either half is inside anything.
    expect(reads(s)).toContain("Neither half of it is judged here")
  })

  /* ── The sparklines ─────────────────────────────────────────────────── */

  it("sparks prime, food and labour off the eight weeks it already loaded, and nothing else", async () => {
    // The prototype sparks three of five cells and leaves the bottom line and
    // gross sales bare (`sp: 3` on its own desk render). The data is the eight
    // weekly statements this page loads anyway for the week table — no extra
    // query, and the same `prime` the cell above prints, so the line and the
    // figure cannot be in different units.
    const s = await load()
    expect(cellOf(s, "Prime cost")?.reference?.series).toHaveLength(8)
    expect(cellOf(s, "Food")?.reference?.series).toHaveLength(8)
    expect(cellOf(s, "Labor")?.reference?.series).toHaveLength(8)
    expect(cellOf(s, "Bottom line")?.reference).toBeUndefined()
    expect(cellOf(s, "Gross sales")?.reference).toBeUndefined()
    // Points, not fractions — the scale the cell prints and the scale the
    // sparkline is drawn at have to be one scale.
    expect(cellOf(s, "Food")?.reference?.series?.[0]).toBeCloseTo(31.4, 1)
    expect(cellOf(s, "Prime cost")?.reference?.series?.[0]).toBeCloseTo(56.2, 1)
  })

  it("keeps the strip when the WEEKS fail, and drops only the sparklines", async () => {
    // The ruling: a sparkline is decoration on a figure that stands alone, and
    // the strip must never inherit the week table's failure. The weeks are
    // their own `classify`, so this is the case that decides which of the two
    // a reader loses.
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { startDate: Date; periods?: unknown[] }) =>
      arg.startDate.getTime() === toQueryBounds(range).startDate.getTime()
        ? rollupFor(arg)
        : { error: "the weekly rollup timed out" }) as never)

    const s = await load()
    expect(s.weeks.status).toBe("failed")
    // Every figure still there, in full.
    expect(must(s.headline, "headline").cells.map((c) => c.label)).toEqual([
      "Bottom line", "Prime cost", "Food", "Labor", "Gross sales",
    ])
    expect(cellOf(s, "Prime cost")?.value).toBe("56.2%")
    // And the judgement survives too — it comes from the targets, not the weeks.
    expect(cellOf(s, "Prime cost")?.reference?.target).toBe(PRIME_CEILING_PCT)
    expect(cellOf(s, "Food")?.reference?.target).toBe(29)
    // Only the trajectory is gone.
    expect(cellOf(s, "Prime cost")?.reference?.series).toBeUndefined()
    expect(cellOf(s, "Food")?.reference?.series).toBeUndefined()
    // Labour had nothing BUT the trajectory, so its reference goes entirely
    // rather than becoming an empty object that would open a band.
    expect(cellOf(s, "Labor")?.reference).toBeUndefined()
  })

  it("drops a week with no labour from the labour line rather than plotting it as zero", async () => {
    // A week with no labour posted has no labour rate. A 0 in the middle of a
    // sparkline draws a collapse that did not happen — the same lie as a
    // "0.0%" labour cell, one element over.
    // ONE week is silent, the fourth. This used to be expressed by keying on
    // the startDate of that week's own rollup call; the eight weeks are now a
    // single call, so the silence lives at index 3 of `perPeriod` — which is
    // the same fact stated where the real rollup states it.
    const SILENT_WEEK = 3
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { periods?: unknown[] }) => {
      const base = rollupFor(arg)
      if (!arg.periods) return base
      return {
        ...base,
        perPeriod: (base.perPeriod as Array<Record<string, number>>).map((k, i) =>
          i === SILENT_WEEK ? { ...k, laborValue: 0, laborPct: 0 } : k,
        ),
      }
    }) as never)

    const s = await load()
    const labor = cellOf(s, "Labor")?.reference?.series
    expect(labor).toHaveLength(7)
    expect(labor).not.toContain(0)
    // Food had a reading that week, so its line keeps all eight.
    expect(cellOf(s, "Food")?.reference?.series).toHaveLength(8)
  })

  it("judges food when the store HAS set a target", async () => {
    const s = await load()
    expect(cellOf(s, "Food")?.reference?.target).toBe(29)
    expect(must(s.weeks, "weeks").foodTargetPct).toBe(29)
  })
})

/* ── The reading ──────────────────────────────────────────────────────── */

describe("the reading paragraph", () => {
  it("names the half that is over, prices it, and bolds the figure that carries it", async () => {
    const s = await load()
    const text = reads(s)
    expect(text).toContain("Prime cost is 56.2%")
    expect(text).toContain("3.8 points under")
    expect(text).toContain("food is 2.4 points over its 29.0% target")
    expect(text).toContain("of this range's margin")
    const bold = must(s.headline, "headline").reading.filter((r) => r.strong)
    expect(bold.some((r) => r.text.includes("56.2%"))).toBe(true)
    expect(bold.some((r) => r.text.includes("points over"))).toBe(true)
  })

  it("says over, not under, when prime breaches the ceiling", async () => {
    const heavy = { ...kpis(), laborValue: 60_000, laborPct: 60_000 / GROSS }
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({ combined: heavy, perStore: [{ ...store("holly", "Hollywood"), ...heavy }] }) as never,
    )
    const s = await load()
    expect(reads(s)).toContain("points over the 60% ceiling")
  })

  it("says what was lost rather than what was kept when the range lost money", async () => {
    const under = { ...kpis(), bottomLine: -4_000, marginPct: -4_000 / GROSS }
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({ combined: under, perStore: [{ ...store("holly", "Hollywood"), ...under }] }) as never,
    )
    const s = await load()
    // Not "You kept ($4,000)", which reads as a positive with brackets on it.
    expect(reads(s)).toContain("You lost $4,000")
  })

  it("never claims labour is inside a target, because nothing publishes one", async () => {
    const s = await load()
    expect(reads(s)).not.toContain("labor is")
  })
})

/* ── The cascade ──────────────────────────────────────────────────────── */

describe("the cascade", () => {
  it("subtracts to the rollup's own bottom line, so the drawing reconciles", async () => {
    const s = await load()
    const c = must(s.cascade, "cascade")
    const end = c.cuts.reduce((t, cut) => t - cut.amount, c.start.amount)
    expect(end).toBeCloseTo(BOTTOM, 6)
  })

  it("is the statement's six lines, in the statement's order", async () => {
    const s = await load()
    expect(must(s.cascade, "cascade").cuts.map((c) => c.name)).toEqual([
      "Marketplace commissions",
      "Food",
      "Labor",
      "Occupancy",
      "Other operating",
    ])
  })

  it("reddens the food cut only when a published target was beaten", async () => {
    const s = await load()
    expect(must(s.cascade, "cascade").cuts.find((c) => c.name === "Food")?.over).toBe(true)

    vi.mocked(loadStripTargets).mockResolvedValue(NO_TARGETS as never)
    const bare = await load()
    // Colour with no published number behind it is the page inventing a verdict.
    expect(must(bare.cascade, "cascade").cuts.find((c) => c.name === "Food")?.over).toBe(false)
  })

  it("counts the orders from the same rows the Overview counts them from", async () => {
    const s = await load()
    expect(must(s.cascade, "cascade").start.sub).toBe("6,000 orders")
    expect(lineOf(s, "gross")?.sub).toBe("6,000 orders")
  })

  it("leaves the order count out rather than printing a zero when the mix fails", async () => {
    vi.mocked(loadChannelMix).mockRejectedValue(new Error("Otter is down"))
    const s = await load()
    expect(must(s.cascade, "cascade").start.sub).toBeUndefined()
    // The cascade itself still draws: the dollars did not come from the mix.
    expect(must(s.cascade, "cascade").start.amount).toBe(GROSS)
  })
})

/* ── The statement table ──────────────────────────────────────────────── */

describe("the statement table", () => {
  it("prints an em-dash in every comparison cell when there is no comparison", async () => {
    const s = await load()
    expect(must(s.statement, "statement").comparisonLabel).toBeNull()
    for (const l of must(s.statement, "statement").lines) {
      expect(l.comparison).toBe("—")
      expect(l.change).toBe("—")
      expect(l.worth).toBe("—")
      expect(l.loud).toBe(false)
    }
  })

  it("calls out only the moves the trade acts on, at the threshold for that line", async () => {
    // The comparison window: food 1.4 points lower, labour unchanged.
    const then = {
      ...kpis(),
      cogsValue: COGS - 2_133.6,
      cogsPct: (COGS - 2_133.6) / GROSS,
    }
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { startDate: Date; periods?: unknown[] }) =>
      arg.startDate.getTime() === toQueryBounds({ start: new Date(2026, 7, 10), end: new Date(2026, 7, 16) }).startDate.getTime()
        ? rollupFor(arg, { combined: then, perStore: [{ ...store("holly", "Hollywood"), ...then }] })
        : rollup()) as never)

    const s = await load({ comparisonId: "prev" })
    const food = lineOf(s, "food")
    expect(food?.change).toBe("▲ 1.4 pts")
    // One point on food is the threshold the footnote names.
    expect(food?.loud).toBe(true)
    // The same 1.4 points on prime is under prime's three-point threshold.
    expect(lineOf(s, "prime")?.change).toBe("▲ 1.4 pts")
    expect(lineOf(s, "prime")?.loud).toBe(false)
  })

  it("prices a move in the dollars it is worth at this range's volume", async () => {
    const then = { ...kpis(), cogsValue: COGS - 1_524, cogsPct: (COGS - 1_524) / GROSS }
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { startDate: Date; periods?: unknown[] }) =>
      arg.startDate.getTime() === toQueryBounds({ start: new Date(2026, 7, 10), end: new Date(2026, 7, 16) }).startDate.getTime()
        ? rollupFor(arg, { combined: then, perStore: [{ ...store("holly", "Hollywood"), ...then }] })
        : rollup()) as never)

    const s = await load({ comparisonId: "prev" })
    // One point of $152,400 is $1,524.
    expect(lineOf(s, "food")?.change).toBe("▲ 1.0 pts")
    expect(lineOf(s, "food")?.worth).toBe("+$1,524")
  })

  it("compares gross sales in dollars and every other line in points", async () => {
    const s = await load({ comparisonId: "prev" })
    expect(lineOf(s, "gross")?.comparison).toBe("$152,400")
    expect(lineOf(s, "food")?.comparison).toBe("31.4%")
  })

  it("draws a cost line with the minus the drawing owns, not `money`'s brackets", async () => {
    const s = await load()
    expect(lineOf(s, "food")?.amount).toBe("−$47,854")
    expect(lineOf(s, "gross")?.amount).toBe("$152,400")
  })

  it("sends a line only where this app actually has a page", async () => {
    const s = await load()
    expect(lineOf(s, "food")?.href).toBe("/dashboard/cogs")
    expect(lineOf(s, "labor")?.href).toBe("/dashboard/labor")
    // Sums are not destinations.
    expect(lineOf(s, "prime")?.href).toBeUndefined()
    expect(lineOf(s, "bottom")?.href).toBeUndefined()
  })

  it("divides the four-occurrence weekday window's money before comparing it", async () => {
    const four = { ...kpis(), grossSales: GROSS * 4, netAfterCommissions: (GROSS - COMMISSIONS) * 4 }
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { startDate: Date; periods?: unknown[] }) =>
      arg.startDate.getTime() < range.start.getTime() - 7 * 86_400_000
        ? rollupFor(arg, { combined: four, perStore: [{ ...store("holly", "Hollywood"), ...four }] })
        : rollup()) as never)

    const s = await load({ comparisonId: "weekday" })
    // Four weeks of $152,400 is one week of $152,400 — flat, not −75%.
    expect(lineOf(s, "gross")?.comparison).toBe("$152,400")
    expect(lineOf(s, "gross")?.change).toBe("flat")
  })
})

/* ── Two empty states ─────────────────────────────────────────────────── */

describe("empty is two different states (note 23)", () => {
  it("is `no_match` for a store this account does not own", async () => {
    const s = await load({ storeId: "someone-elses" })
    for (const key of ["headline", "cascade", "weeks", "statement"] as const) {
      expect(s[key].status, key).toBe("empty")
      if (s[key].status === "empty") expect(s[key].reason, key).toBe("no_match")
    }
  })

  it("still lists the account's stores when the selected store is not one of them", async () => {
    // The section that says what you CAN look at must survive the dead end.
    const s = await load({ storeId: "someone-elses" })
    expect(must(s.byStore, "byStore").map((x) => x.id)).toEqual(["holly", "gln"])
  })

  it("is `pre_open` for an account whose stores have all not opened", async () => {
    vi.mocked(getStores).mockResolvedValue([GLENDALE] as never)
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({
        combined: EMPTY_STORE,
        perStore: [store("gln", "Glendale", EMPTY_STORE)],
      }) as never,
    )
    const s = await load()
    expect(s.headline.status).toBe("empty")
    if (s.headline.status === "empty") expect(s.headline.reason).toBe("pre_open")
  })

  it("is `pre_open` for a pre-open store selected out of a trading account", async () => {
    vi.mocked(getAllStoresPnL).mockImplementation((async (arg: { periods?: unknown[] }) =>
    rollupFor(arg)) as never)
    const s = await load({ storeId: "gln" })
    expect(s.headline.status).toBe("empty")
    if (s.headline.status === "empty") expect(s.headline.reason).toBe("pre_open")
  })

  it("is `no_match` for a range that caught no trade at a store that HAS opened", async () => {
    // Nothing is broken and nothing is unopened: the filter matched nothing,
    // and widening the range is the way out.
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({
        combined: EMPTY_STORE,
        perStore: [store("holly", "Hollywood", EMPTY_STORE)],
      }) as never,
    )
    const s = await load({ storeId: "holly" })
    expect(s.headline.status).toBe("empty")
    if (s.headline.status === "empty") expect(s.headline.reason).toBe("no_match")
  })
})

/* ── By store ─────────────────────────────────────────────────────────── */

describe("by store", () => {
  it("lists EVERY store even when the page is scoped to one", async () => {
    const s = await load({ storeId: "holly" })
    // The prototype prints all three stores in this table whatever the
    // switcher says: the question here is which stores are in the statement.
    expect(must(s.byStore, "byStore").map((x) => x.id)).toEqual(["holly", "gln"])
    expect(must(s.headline, "headline").cells.length).toBeGreaterThan(0)
  })

  it("takes that list off the SAME rollup call, not a second one", async () => {
    await load({ storeId: "holly" })
    // The point of this test is unchanged and is the whole plan: the by-store
    // table must come off a call the page already made. What changed is how
    // many that is — 1 selected + 1 for all eight weeks, where it used to be
    // 1 + 8. A THIRD call here would be the second rollup this prevents.
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(2)
  })

  it("gives a store that has not traded no figures at all, and says why", async () => {
    const s = await load()
    const gln = must(s.byStore, "byStore").find((x) => x.id === "gln")
    expect(gln?.stage).toBe("pre_open")
    expect(gln?.grossSales).toBeNull()
    expect(gln?.primePct).toBeNull()
    expect(gln?.fixedOnFile).toBeNull()
    expect(gln?.rentOnFile).toBe(false)
  })

  it("puts the store with customers first, whatever `getStores` sorted by", async () => {
    vi.mocked(getStores).mockResolvedValue([GLENDALE, HOLLY] as never)
    const s = await load()
    expect(must(s.byStore, "byStore").map((x) => x.id)).toEqual(["holly", "gln"])
  })

  it("charges a trading store the rent the rollup prorated to this range", async () => {
    const s = await load()
    expect(must(s.byStore, "byStore").find((x) => x.id === "holly")?.fixedOnFile).toBe(RENT)
  })
})

/* ── Failure is per section ───────────────────────────────────────────── */

describe("failure", () => {
  it("carries the rollup's own refusal to the reader rather than an empty statement", async () => {
    vi.mocked(getAllStoresPnL).mockResolvedValue({ error: "P&L is restricted to owners" } as never)
    const s = await load()
    expect(s.headline.status).toBe("failed")
    if (s.headline.status === "failed") {
      expect(s.headline.error).toBe("P&L is restricted to owners")
      expect(s.headline.retryAction).toBe("retryStatement")
    }
  })

  it("keeps the store list when the statement fails, and the statement when the list fails", async () => {
    vi.mocked(getStores).mockRejectedValue(new Error("stores are down"))
    const s = await load()
    expect(s.byStore.status).toBe("failed")
    expect(s.headline.status).toBe("ready")
  })
})

/* ── The phone's own two figures ──────────────────────────────────────── */

/**
 * `P.pnl.phone()` (`docs/counter/counter-prototype.html:5354`) draws a
 * two-cell `mstrip`, not the desk's five-cell `strip`, and its prime cell
 * carries a DIFFERENT second line: the room left under the ceiling rather than
 * the move against the comparison. That is arithmetic, so it is here and not
 * in the page — a page composes, it does not compute.
 */
describe("the phone's strip", () => {
  const phone = (s: PnlSections): StripCell[] => must(s.headline, "headline").phoneCells

  it("is the prototype's two cells, in its order", async () => {
    const s = await load()
    expect(phone(s).map((c) => c.label)).toEqual(["Bottom line", "Prime cost"])
  })

  it("prints the same two figures the desk's own strip prints", async () => {
    // One page, one number: the phone is not a second reading of the range.
    const s = await load()
    expect(phone(s)[0].value).toBe(cellOf(s, "Bottom line")?.value)
    expect(phone(s)[1].value).toBe(cellOf(s, "Prime cost")?.value)
  })

  it("names the room left under the ceiling, not the move against the comparison", async () => {
    const s = await load({ comparisonId: "prev" })
    // 60.0 − 56.2 = 3.8, and `PrimeCost.roomPp` is what owns that subtraction.
    expect(phone(s)[1].delta).toBe("3.8 pts of room")
    expect(phone(s)[1].deltaTone).toBeUndefined()
  })

  it("says a breach is over the ceiling rather than printing negative room", async () => {
    // The prototype writes `(PRIME_PLAN - prime).toFixed(1) + ' pts of room'`,
    // which reads "−3.2 pts of room" on a breach — a quantity of room that is
    // less than none. The direction is the same; the words are the ones a
    // reader can act on.
    const over = GROSS * 0.7
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({
        combined: kpis({ laborValue: over - COGS, laborPct: (over - COGS) / GROSS }),
        perStore: [
          store("holly", "Hollywood", {
            laborValue: over - COGS,
            laborPct: (over - COGS) / GROSS,
          }),
        ],
      }) as never,
    )
    const s = await load()
    expect(phone(s)[1].delta).toBe("10.0 pts over the ceiling")
    expect(phone(s)[1].deltaTone).toBe("is-down")
  })

  it("judges prime against the trade's ceiling and the bottom line against nothing", async () => {
    const s = await load()
    expect(phone(s)[0].reference).toBeUndefined()
    const r = phone(s)[1].reference as Reference
    expect(r.target).toBe(PRIME_CEILING_PCT)
    expect(r.better).toBe("low")
    expect(isJudged(r)).toBe(true)
  })

  it("carries no trajectory: the phone takes the mark and not the sparkline", async () => {
    // `mstrip()`'s own comment — the two charts are directly beneath it and
    // vertical space is the scarce thing on a phone. The desk's prime cell
    // DOES carry the eight weeks, which is what makes this assertion mean
    // something.
    const s = await load()
    expect((cellOf(s, "Prime cost")?.reference as Reference).series).toBeDefined()
    for (const c of phone(s)) expect(c.reference?.series).toBeUndefined()
  })

  it("carries no caption: `mstrip` opens its band on the reference alone", async () => {
    const s = await load()
    for (const c of phone(s)) expect(c.caption).toBeUndefined()
  })

  it("drops the prime cell — and only that cell — when no labour is posted", async () => {
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      rollup({
        combined: kpis({ laborValue: 0, laborPct: 0 }),
        perStore: [store("holly", "Hollywood", { laborValue: 0, laborPct: 0 })],
      }) as never,
    )
    const s = await load()
    expect(phone(s).map((c) => c.label)).toEqual(["Bottom line"])
  })
})

/* ── The two things the phone's statement needs and the desk's does not ─ */

describe("the phone's statement", () => {
  it("carries the fixed lines charged to this range, for the note under it", async () => {
    // The prototype's `fixedInRange(null, a.days)`. Rent plus the other
    // monthly lines, prorated by the rollup — never a whole month.
    const s = await load()
    expect(must(s.statement, "statement").fixedInRange).toBe("$7,000")
  })

  it("marks the food line as over when it beat the target on file", async () => {
    // 31.4% against a 29.0% target. `over` is a JUDGEMENT against a published
    // number, not `loud` — which is about the size of a MOVE and would paint
    // a food line that is comfortably under its target but moved 1.2 points.
    const s = await load()
    expect(lineOf(s, "food")?.over).toBe(true)
    expect(lineOf(s, "commissions")?.over).toBeUndefined()
  })

  it("says nothing about `over` when no target is on file", async () => {
    // Absent, not `false`: "not over" and "there is nothing to be over" are
    // different answers, and only one of them is true here.
    vi.mocked(loadStripTargets).mockResolvedValue(NO_TARGETS as never)
    const s = await load()
    expect(lineOf(s, "food")?.over).toBeUndefined()
  })
})
