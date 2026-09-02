import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn() }))
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))
vi.mock("@/app/actions/invoice-actions", () => ({ getInvoiceSummary: vi.fn() }))
vi.mock("@/app/actions/splh-actions", () => ({ getSplhSeries: vi.fn() }))
vi.mock("@/app/actions/alerts/inbox-actions", () => ({ getAlertInbox: vi.fn() }))
vi.mock("@/app/actions/forecasts/revenue-forecast-actions", () => ({
  getRevenueForecast: vi.fn(),
}))
// Both of these import `@/lib/prisma` at module load; mocking them keeps the
// adapter importable without a DATABASE_URL, which is the same reason the
// adapter takes an accountId instead of fetching its own session.
vi.mock("@/app/actions/ratings/ratings-actions", () => ({ getRatingsSummary: vi.fn() }))
vi.mock("@/lib/counter/channel-mix", () => ({
  loadChannelMix: vi.fn(),
  // The per-store readings now come from ONE query that keeps the rows
  // partitioned, rather than N calls to loadChannelMix — see
  // `loadChannelMixByStore`. Mocked alongside its sibling so this suite keeps
  // asserting the SHAPE the section produces rather than how many round trips
  // it took to build it.
  loadChannelMixByStore: vi.fn(),
}))
vi.mock("@/lib/counter/targets", () => ({ loadStripTargets: vi.fn() }))

import { getStores } from "@/app/actions/store/crud-actions"
import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getSplhSeries } from "@/app/actions/splh-actions"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"
import { loadChannelMix, loadChannelMixByStore } from "@/lib/counter/channel-mix"
import { loadStripTargets } from "@/lib/counter/targets"
import { toQueryBounds } from "@/lib/counter/date-range"
import { PRIME_CEILING_PCT } from "@/lib/counter/prime-cost"
import { hasData } from "@/lib/counter/section-data"
import {
  getOverviewSections,
  type OverviewSections,
  type StripCell,
} from "@/lib/counter/adapters/overview"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 19) }
const accountId = "acct_1"
// Task 3c (A-R19): `toQueryBounds` now rebuilds the local calendar day as a
// UTC instant, so `range.start`'s raw local-midnight `Date` is no longer the
// same instant as the primary window's queried `startDate`. Tests below that
// need to tell the "primary" load apart from the "comparison" load by their
// bound must compare against THIS, not against `range.start` directly.
const primaryStart = toQueryBounds(range).startDate

/** Two daily buckets: $4,000 then $3,468. COGS $2,200, labour $1,900. */
function pnlRows() {
  return [
    { code: "TOTAL_SALES", label: "Total Sales", values: [4000, 3468], percents: [1, 1] },
    { code: "6100", label: "Cost of Goods Sold", values: [-1200, -1000], percents: [-0.3, -0.288] },
    { code: "6200", label: "Labor", values: [-1000, -900], percents: [-0.25, -0.26] },
  ]
}

function pnl(overrides: Record<string, unknown> = {}) {
  const kpis = {
    grossSales: 7468,
    netAfterCommissions: 7000,
    fixedCosts: 1900,
    bottomLine: 3368,
    marginPct: 0.45,
    cogsValue: 2200,
    cogsPct: 2200 / 7468,
    laborValue: 1900,
    laborPct: 1900 / 7468,
    rentValue: 0,
    rentPct: 0,
  }
  return {
    storeCount: 2,
    combined: kpis,
    perStore: [
      {
        storeId: "holly",
        storeName: "Hollywood",
        ...kpis,
        channelMix: [],
        fixedCostsConfigured: true,
        rows: pnlRows(),
      },
    ],
    consolidatedRows: pnlRows(),
    periods: [
      { label: "Tue Aug 18", startDate: range.start, endDate: range.start, days: 1, isPartial: false },
      { label: "Wed Aug 19", startDate: range.end, endDate: range.end, days: 1, isPartial: false },
    ],
    ...overrides,
  }
}

const HOLLY = {
  id: "holly",
  name: "Hollywood",
  lifecycleStage: "ready",
  openedAt: new Date(2024, 0, 1),
  fixedMonthlyRent: 12000,
  fixedMonthlyLabor: 40000,
  targetCogsPct: 28.5,
}
const GLENDALE = {
  id: "glendale",
  name: "Glendale",
  lifecycleStage: "pre_open",
  openedAt: null,
  fixedMonthlyRent: null,
  fixedMonthlyLabor: 30000,
  targetCogsPct: null,
}

function splhSeries() {
  return [
    {
      storeId: "holly",
      storeName: "Hollywood",
      blendedRate: 21.5,
      daysCovered: 2,
      daysMissingHours: 0,
      points: [
        { date: "2026-08-18", label: "Tue 18", weekday: 2, netSales: 4000, laborHours: 56, splh: 71.4, targetSplh: null, earnedHours: null, varianceHours: null, varianceDollars: null, status: "unknown" },
        { date: "2026-08-19", label: "Wed 19", weekday: 3, netSales: 3468, laborHours: 50, splh: 69.4, targetSplh: null, earnedHours: null, varianceHours: null, varianceDollars: null, status: "unknown" },
      ],
    },
  ]
}

const NO_TARGETS = {
  orders: null, ticket: null, foodCost: null,
  labor: null, prime: null, marketplaceFees: null,
}

const CHANNELS = [
  { channel: "house", net: 4000, orders: 160, commission: 0, ticket: 25 },
  { channel: "doordash", net: 2000, orders: 80, commission: 500, ticket: 25 },
  // No rate column exists for Grubhub. Task 1 carries the null through rather
  // than reporting a marketplace that works for free.
  { channel: "grubhub", net: 1468, orders: 60, commission: null, ticket: 24.47 },
]

const RATINGS = {
  windowDays: 30, stale: false, latestReviewAt: new Date(2026, 7, 24),
  count: 142, average: 4.62, lowCount: 1, distribution: [1, 0, 4, 30, 107],
  deltaVsPrior: null, byPlatform: [], recent: [],
}

const INVOICES = {
  totalSpend: 63203, invoiceCount: 34, avgInvoiceTotal: 1858.9,
  pendingReviewCount: 6, pendingReviewTotal: 2140, vendorCount: 12,
  spendByVendor: [], spendByCategory: [],
}

function inbox(alerts: unknown[] = []) {
  return {
    ok: true,
    data: {
      alerts,
      counts: { open: alerts.length, critical: 0, watch: 0, info: 0 },
      stores: [{ id: "holly", name: "Hollywood" }],
    },
  }
}

function alert(over: Record<string, unknown> = {}) {
  return {
    id: "a1", storeId: "holly", storeName: "Hollywood",
    source: "PRICE_DELTA", target: "INGREDIENT", targetId: "beef",
    severity: "CRITICAL", status: "OPEN",
    title: "Ground beef is up in three weeks", body: "$4.12 to $4.86 per lb",
    occurredOn: new Date(Date.UTC(2026, 7, 19)),
    detectedAt: new Date(), explanation: null,
    ...over,
  }
}

function forecast(days: unknown[]) {
  return {
    ok: true,
    data: {
      storeId: null, storeName: "All stores", generatedAt: new Date(),
      recentMape: 7.1, days, openedAt: null,
    },
  }
}

/** Everything green. Individual tests override one mock at a time. */
function happyPath() {
  vi.mocked(getStores).mockResolvedValue([HOLLY, GLENDALE] as never)
  vi.mocked(getAllStoresPnL).mockResolvedValue(pnl() as never)
  vi.mocked(getInvoiceSummary).mockResolvedValue(INVOICES as never)
  vi.mocked(getSplhSeries).mockResolvedValue(splhSeries() as never)
  vi.mocked(getAlertInbox).mockResolvedValue(inbox([alert()]) as never)
  vi.mocked(getRevenueForecast).mockResolvedValue(forecast([]) as never)
  vi.mocked(getRatingsSummary).mockResolvedValue(RATINGS as never)
  vi.mocked(loadChannelMix).mockResolvedValue(CHANNELS as never)
  // Every operational store reads the same fixture, which is what the N-call
  // version produced too.
  vi.mocked(loadChannelMixByStore).mockResolvedValue(
    new Map([
      ["holly", CHANNELS],
      ["glendale", CHANNELS],
    ]) as never,
  )
  vi.mocked(loadStripTargets).mockResolvedValue(NO_TARGETS as never)
}

const load = (over: Partial<Parameters<typeof getOverviewSections>[0]> = {}) =>
  getOverviewSections({ range, storeId: null, accountId, ...over })

function cell(s: OverviewSections, label: string): StripCell | undefined {
  return hasData(s.strip) ? s.strip.data.find((c) => c.label === label) : undefined
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("getOverviewSections", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    happyPath()
  })

  it("returns every section the page composes, named", async () => {
    const s = await load()
    for (const key of [
      "sales", "splh", "strip", "verdict", "moving", "needsYou",
      "salesChart", "splhChart", "stores", "comparison", "channels", "invoices",
      "ratings",
    ]) {
      expect(s[key as keyof OverviewSections]).toBeDefined()
    }
  })

  it("asks getSplhSeries for the SELECTED range, not a trailing window", async () => {
    await load()
    const [granularity, passedRange] = vi.mocked(getSplhSeries).mock.calls[0]
    expect(granularity).toBe("day")
    // `toQueryBounds` — UTC-anchored (task 3c): the end bound is 23:59:59
    // UTC on the last day, because a query filtering on local midnight drops
    // the whole of it.
    expect(passedRange).toEqual(toQueryBounds(range))
  })

  it("scopes sales per labour hour to the range and publishes no invented floor", async () => {
    const s = await load()
    expect(s.splh.status).toBe("ready")
    if (!hasData(s.splh)) throw new Error("splh")
    // (4000 + 3468) / (56 + 50) — total net over total hours, never the mean
    // of the daily ratios.
    expect(s.splh.data.value).toBeCloseTo(7468 / 106, 6)
    // The prototype's SPLH_FLOOR = 68.00 exists nowhere in the schema.
    expect(s.splh.data.floor).toBeNull()
    expect(s.splh.data.series).toEqual([71.4, 69.4])
  })

  it("never marks needsYou owed — getAlertInbox has been in the tree since F21", async () => {
    const s = await load()
    expect(s.needsYou.status).toBe("ready")
    if (!hasData(s.needsYou)) throw new Error("needsYou")
    expect(s.needsYou.data[0].title).toBe("Ground beef is up in three weeks")
    expect(s.needsYou.data[0].tone).toBe("bad")

    // An empty inbox is a real state — nothing needs you — not owed work.
    vi.mocked(getAlertInbox).mockResolvedValue(inbox([]) as never)
    expect((await load()).needsYou.status).toBe("empty")

    // And a refused inbox is a failure the reader must see, still not owed.
    vi.mocked(getAlertInbox).mockResolvedValue({ ok: false, error: "unauthorized" } as never)
    expect((await load()).needsYou.status).toBe("failed")
  })

  it("gives a pre-open store a card shape with no net-sales field at all", async () => {
    const s = await load()
    if (!hasData(s.stores)) throw new Error("stores")
    const glendale = s.stores.data.find((c) => c.id === "glendale")
    if (!glendale) throw new Error("glendale")
    expect(glendale.kind).toBe("pre_open")
    // Note 33: the em-dash table is what the design deleted. The union makes
    // the absence structural — there is no key to read, null or otherwise.
    expect("grossSales" in glendale).toBe(false)
    expect("orders" in glendale).toBe(false)
    expect("ticket" in glendale).toBe(false)
    expect("series" in glendale).toBe(false)
    if (glendale.kind !== "pre_open") throw new Error("kind")
    // What it DOES have: real, from the store's own file.
    expect(glendale.missingFromFile).toEqual(["Rent", "Food-cost target", "Opening date"])
    expect(glendale.opensOn).toBeNull()

    const holly = s.stores.data.find((c) => c.id === "holly")
    if (holly?.kind !== "trading") throw new Error("holly")
    expect(holly.grossSales).toBe(7468)
    expect(holly.orders).toBe(300)
  })

  it("gives a trading card its own channel rows, so its drawer is not a second query", async () => {
    const s = await load()
    if (!hasData(s.stores)) throw new Error("stores")
    const holly = s.stores.data.find((c) => c.id === "holly")
    if (holly?.kind !== "trading") throw new Error("holly")
    // The same readings the strip's orders and ticket came from — one call per
    // store, not one call per drawer.
    expect(holly.channels.map((c) => c.id)).toEqual(["house", "doordash", "grubhub"])
    expect(holly.channels[0]).toEqual({ id: "house", net: 4000, orders: 160 })
  })

  it("maps the lifecycle stage in ONE place, and a warming-up store still trades", async () => {
    const s = await load()
    if (!hasData(s.stores)) throw new Error("stores")
    const holly = s.stores.data.find((c) => c.id === "holly")
    if (holly?.kind !== "trading") throw new Error("holly")
    expect(holly.stage).toBe("trading")
  })

  it("renders a channel with zero orders as a null ticket, never $0.00", async () => {
    vi.mocked(loadChannelMix).mockResolvedValue([
      { channel: "house", net: 4000, orders: 160, commission: 0, ticket: 25 },
      { channel: "grubhub", net: 0, orders: 0, commission: null, ticket: null },
    ] as never)
    const s = await load()
    if (!hasData(s.channels)) throw new Error("channels")
    const grubhub = s.channels.data.find((c) => c.channel === "grubhub")
    expect(grubhub?.ticket).toBeNull()
    // And the null commission is carried through, not coalesced to a zero that
    // would claim Grubhub works for free.
    expect(grubhub?.commission).toBeNull()
  })

  it("keeps a figure with no published target free of a bullet reference", async () => {
    const s = await load()
    // Five of six publish nothing (Task 1 Step 4). A bullet asserts somebody
    // set this benchmark; nobody did.
    for (const label of ["Orders", "Avg ticket", "Labor", "Marketplace fees"]) {
      const c = cell(s, label)
      expect(c, label).toBeDefined()
      expect(c?.reference?.target, label).toBeUndefined()
      expect(c?.reference?.lo, label).toBeUndefined()
    }
    // Food cost is bare too when the store has no plan set.
    expect(cell(s, "Food cost")?.reference?.target).toBeUndefined()

    // The one published reference the schema has turns exactly one bullet on.
    vi.mocked(loadStripTargets).mockResolvedValue({
      ...NO_TARGETS,
      foodCost: { kind: "target", value: 28.5, better: "low" },
    } as never)
    const withPlan = await load()
    expect(cell(withPlan, "Food cost")?.reference?.target).toBe(28.5)
    expect(cell(withPlan, "Orders")?.reference?.target).toBeUndefined()
  })

  it("takes the prime cell's ceiling from primeCost, never from loadStripTargets", async () => {
    const s = await load()
    const prime = cell(s, "Prime cost")
    // `loadStripTargets` returned `prime: null` — and the cell is STILL judged,
    // because 60% is the trade's published benchmark and prime-cost.ts owns it.
    // If this ever reads `undefined`, somebody deleted PRIME_CEILING_PCT or
    // wired the cell to targets.ts. Read the module comment before "fixing" it.
    expect(prime?.reference?.target).toBe(PRIME_CEILING_PCT)
    expect(vi.mocked(loadStripTargets).mock.results.length).toBeGreaterThan(0)
  })

  it("names what the marketplace-fee figure excludes rather than counting it at zero", async () => {
    const s = await load()
    const fees = cell(s, "Marketplace fees")
    // $500 from DoorDash and nothing from Grubhub, which publishes no rate.
    expect(fees?.value).toBe("$500")
    expect(fees?.caption).toBe("excludes grubhub")
    // `.strip .band` is a 9px mono line with `white-space:nowrap` and a
    // six-track strip cell holds about 31 characters. A caption that
    // overflows its own cell is not a caption.
    expect((fees?.caption ?? "").length).toBeLessThanOrEqual(31)
  })

  it("draws the sales chart from the SAME rollup as the headline, bucket by bucket", async () => {
    const s = await load()
    if (!hasData(s.salesChart) || !hasData(s.sales)) throw new Error("chart")
    const bars = s.salesChart.data.series[0].data
    expect(bars).toEqual([4000, 3468])
    // Note 39: a total is the sum of the series drawn beside it.
    expect(bars.reduce<number>((t, v) => t + (v ?? 0), 0)).toBe(s.sales.data.grossSales)
  })

  it("draws no comparison line and claims no delta when the reader switched it off", async () => {
    const s = await load()
    expect(s.salesChart.status).toBe("ready")
    if (!hasData(s.salesChart) || !hasData(s.sales)) throw new Error("chart")
    expect(s.salesChart.data.series).toHaveLength(1)
    expect(s.sales.data.comparison).toBe("no comparison set")
    // ...and it says so in the MUTED tone, not the tone of a rise. `.headline
    // .d` / `.mhead .d` paint var(--good) unclassed, so "no comparison set"
    // unclassed is an absence rendered as good news.
    expect(s.sales.data.comparisonTone).toBe("is-flat")
    // The comparison rollup is never even queried.
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(1)
  })

  it("tones the head figure's delta, so a fall does not read as good news", async () => {
    // The defect this closes was visible in the browser on both surfaces: net
    // sales down 37.2% printed "▼ 37.2% vs the prior period" in var(--good).
    // The sheet gained the rule (an extractor CORRECTIONS entry); the tone
    // itself is a JUDGEMENT ABOUT THE FIGURE and is decided here, which is why
    // it is asserted here.
    const cmpAt = (previous: number) => {
      vi.mocked(getAllStoresPnL).mockImplementation(async (input) =>
        (input.startDate.getTime() < primaryStart.getTime()
          ? pnl({ combined: { ...pnl().combined, grossSales: previous } })
          : pnl()) as never,
      )
      return load({ comparisonId: "prev" })
    }

    // pnl()'s own gross sales is the "now" side; a bigger previous is a fall.
    const down = await cmpAt(20000)
    if (!hasData(down.sales)) throw new Error("down")
    expect(down.sales.data.comparison).toMatch(/^▼/)
    expect(down.sales.data.comparisonTone).toBe("is-down")

    const up = await cmpAt(1000)
    if (!hasData(up.sales)) throw new Error("up")
    expect(up.sales.data.comparison).toMatch(/^▲/)
    // A rise is the DEFAULT and carries no class — the prototype's own choice,
    // and the reason `DeltaTone` has no "is-up".
    expect(up.sales.data.comparisonTone).toBeUndefined()
  })

  it("reads the comparison off its own rollup when one is asked for", async () => {
    vi.mocked(getAllStoresPnL).mockImplementation(async (input) =>
      (input.startDate.getTime() < primaryStart.getTime()
        ? pnl({ combined: { ...pnl().combined, grossSales: 7000 } })
        : pnl()) as never,
    )
    const s = await load({ comparisonId: "prev" })
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(2)
    if (!hasData(s.sales) || !hasData(s.salesChart)) throw new Error("cmp")
    expect(s.sales.data.comparison).toBe("▲ 6.7% vs the prior period")
    expect(s.salesChart.data.series[1].dash).toBe(true)
  })

  it("builds the comparison table from the rollup it already loaded, not a second query", async () => {
    vi.mocked(getAllStoresPnL).mockImplementation(async (input) =>
      (input.startDate.getTime() < primaryStart.getTime()
        ? pnl({ combined: { ...pnl().combined, grossSales: 7000 } })
        : pnl()) as never,
    )
    const s = await load({ comparisonId: "prev" })
    if (!hasData(s.comparison)) throw new Error("comparison")
    expect(s.comparison.data.map((r) => r.figure)).toEqual([
      "Net sales",
      "Food cost",
      "Labor",
      "Prime cost",
    ])
    const net = s.comparison.data[0]
    expect([net.now, net.then, net.change]).toEqual(["$7,468", "$7,000", "\u25b2 6.7%"])
    // Nothing was asked about the comparison window except the P&L: the
    // prototype's orders / ticket / SPLH rows would each be a second round
    // trip for a drawer that starts closed.
    expect(vi.mocked(loadChannelMix)).not.toHaveBeenCalledWith(
      expect.objectContaining({ range: expect.objectContaining({ end: expect.anything() }), comparison: true }),
    )
    expect(vi.mocked(getSplhSeries)).toHaveBeenCalledTimes(1)
  })

  it("marks a cost that went UP as the bad direction, and leaves one that fell alone", async () => {
    vi.mocked(getAllStoresPnL).mockImplementation(async (input) =>
      (input.startDate.getTime() < primaryStart.getTime()
        ? // Same sales, less COGS: this range's food cost is HIGHER.
          pnl({ combined: { ...pnl().combined, cogsValue: 1800, cogsPct: 1800 / 7468 } })
        : pnl()) as never,
    )
    const s = await load({ comparisonId: "prev" })
    if (!hasData(s.comparison)) throw new Error("comparison")
    const food = s.comparison.data.find((r) => r.figure === "Food cost")
    expect(food?.bad).toBe(true)
    expect(food?.change).toContain("pts")
  })

  it("divides the weekday window's money by four before reading it against one period", async () => {
    // `comparisonRange("weekday")` returns a window CONTAINING four
    // occurrences, not an equivalent period. Undivided, every weekday
    // comparison would report this range as down 75%.
    vi.mocked(getAllStoresPnL).mockImplementation(async (input) =>
      (input.startDate.getTime() < primaryStart.getTime()
        ? pnl({ combined: { ...pnl().combined, grossSales: 29_872 } })
        : pnl()) as never,
    )
    const s = await load({ comparisonId: "weekday" })
    if (!hasData(s.comparison)) throw new Error("comparison")
    const net = s.comparison.data[0]
    expect(net.then).toBe("$7,468")
    expect(net.change).toBe("flat")
  })

  it("has nothing to compare when the reader turned the comparison off", async () => {
    const s = await load()
    expect(s.comparison.status).toBe("empty")
  })

  it("reads guest ratings on their OWN window, not the page's range", async () => {
    const s = await load()
    if (!hasData(s.ratings)) throw new Error("ratings")
    // Pre-formatted here: a page never formats a number, and a star average
    // has no formatter in @/lib/counter/format.
    expect(s.ratings.data.average).toBe("4.6")
    expect(s.ratings.data.windowDays).toBe(30)
    // A review arrives days after the meal, so a one-day range would show an
    // empty tile about a restaurant with 142 reviews.
    expect(vi.mocked(getRatingsSummary)).toHaveBeenCalledWith({ storeId: null })
  })

  it("says the ratings tile is empty rather than printing a 0.0 nobody earned", async () => {
    vi.mocked(getRatingsSummary).mockResolvedValue({
      ...RATINGS, count: 0, average: null,
    } as never)
    const s = await load()
    expect(s.ratings.status).toBe("empty")
  })

  it("derives the verdict from a breach, and owes one when nothing is judged", async () => {
    // grossSales 7468, cogs 2200 + labour 1900 = 4100 → 54.9% prime, under the
    // 60% ceiling, and no other figure is judged.
    const s = await load()
    expect(s.verdict.status).toBe("ready")
    if (!hasData(s.verdict)) throw new Error("verdict")
    expect(s.verdict.data.tone).toBe("good")

    // Push food cost over a published plan and the sentence names THAT figure.
    vi.mocked(loadStripTargets).mockResolvedValue({
      ...NO_TARGETS,
      foodCost: { kind: "target", value: 20, better: "low" },
    } as never)
    const breached = await load()
    if (!hasData(breached.verdict)) throw new Error("breached")
    expect(breached.verdict.data.tone).toBe("bad")
    expect(breached.verdict.data.body).toContain("Food cost")
    expect(breached.verdict.data.action?.href).toBe("/dashboard/cogs")

    // With no sales there is no prime cost and nothing publishes anything
    // else: no verdict to write, so it says what is missing instead of
    // printing a cheerful sentence with no evidence behind it.
    vi.mocked(loadStripTargets).mockResolvedValue(NO_TARGETS as never)
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      pnl({ combined: { ...pnl().combined, grossSales: 0, laborValue: 0 } }) as never,
    )
    const owed = await load()
    expect(owed.verdict.status).toBe("not_computed")
    if (owed.verdict.status !== "not_computed") throw new Error("owed")
    expect(owed.verdict.owed).toContain("targetCogsPct")
  })

  it("writes invoices as money lines, and does not guess the line the schema cannot answer", async () => {
    const s = await load()
    if (!hasData(s.invoices)) throw new Error("invoices")
    // The prototype's own order (line 4351): received, what reached COGS,
    // what is still held up.
    expect(s.invoices.data.map((l) => l.label)).toEqual([
      "Received",
      "Posted to COGS",
      "In review",
    ])
    expect(s.invoices.data[0].value).toBe("34 · $63,203")
    expect(s.invoices.data[2].tone).toBe("warn")
    // `.moneyline.total` is the heavy closing line, and the prototype's is
    // "Does not reconcile" — the one figure of the four this schema cannot
    // answer, because `getInvoiceSummary` never surfaces
    // `Invoice.reviewReasons`. So no line wears it: a bold rule under a line
    // that is not the bottom line is a shape that claims something.
    expect(s.invoices.data.some((l) => l.total)).toBe(false)
    expect(s.invoices.data.some((l) => /reconcile/i.test(l.label))).toBe(false)
    expect(s.invoices.data.some((l) => /reconcile/i.test(l.label))).toBe(false)
  })

  it("leaves labour and prime out entirely rather than printing a 0.0% nobody earned", async () => {
    vi.mocked(getAllStoresPnL).mockResolvedValue(
      pnl({ combined: { ...pnl().combined, laborValue: 0, laborPct: 0 } }) as never,
    )
    const s = await load()
    expect(cell(s, "Labor")).toBeUndefined()
    expect(cell(s, "Prime cost")).toBeUndefined()
    // The figures that ARE known still render.
    expect(cell(s, "Food cost")).toBeDefined()
    expect(cell(s, "Orders")).toBeDefined()
  })

  it("fails ONE section without taking the others down", async () => {
    vi.mocked(loadChannelMix).mockRejectedValue(new Error("Otter sync timed out"))
    const s = await load()
    expect(s.channels.status).toBe("failed")
    if (s.channels.status !== "failed") throw new Error("channels")
    expect(s.channels.error).toBe("Otter sync timed out")

    // Every other section still resolved, and the strip kept the three cells
    // that never needed the channel rollup.
    expect(s.sales.status).toBe("ready")
    expect(s.splh.status).toBe("ready")
    expect(s.invoices.status).toBe("ready")
    expect(s.needsYou.status).toBe("ready")
    expect(s.strip.status).toBe("ready")
    expect(cell(s, "Food cost")).toBeDefined()
    expect(cell(s, "Orders")).toBeUndefined()
  })

  it("fails the sales family together when the one rollup they share fails", async () => {
    vi.mocked(getAllStoresPnL).mockResolvedValue({ error: "P&L is restricted to owners" } as never)
    const s = await load()
    for (const key of ["sales", "strip", "verdict", "moving", "salesChart"] as const) {
      expect(s[key].status, key).toBe("failed")
    }
    if (s.sales.status !== "failed") throw new Error("sales")
    expect(s.sales.error).toBe("P&L is restricted to owners")
    // And the sections that do not share it are untouched.
    expect(s.splh.status).toBe("ready")
    expect(s.channels.status).toBe("ready")
  })

  it("resolves a selected store from the rollup it already has, not a second query", async () => {
    const s = await load({ storeId: "holly" })
    expect(vi.mocked(getAllStoresPnL)).toHaveBeenCalledTimes(1)
    if (!hasData(s.stores)) throw new Error("stores")
    expect(s.stores.data.map((c) => c.id)).toEqual(["holly"])
    // And a storeId that is not an active store on this account resolves to
    // nothing rather than silently falling back to the whole account.
    const stranger = await load({ storeId: "someone-elses-store" })
    expect(stranger.sales.status).toBe("empty")
  })

  it("scopes every account-wide query by accountId", async () => {
    await load()
    expect(vi.mocked(loadStripTargets)).toHaveBeenCalledWith(null, accountId)
    for (const [arg] of vi.mocked(loadChannelMix).mock.calls) {
      expect(arg.accountId).toBe(accountId)
    }
    // The per-store read is account-scoped for the same reason, and is now a
    // single call rather than one per store.
    for (const [arg] of vi.mocked(loadChannelMixByStore).mock.calls) {
      expect(arg.accountId).toBe(accountId)
    }
  })
})
