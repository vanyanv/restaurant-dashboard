// getSplhSeries — the optional `range`, and what it has to actually scope.
//
// The assertion that matters here is NOT "it returns data". It is "it returns
// data for the range asked for": the query's own bounds, and the days that
// come back as bars. A range parameter that is accepted and then ignored
// would pass every "did it return something" test ever written, and would put
// a trailing 14-day SPLH under a label that says "Aug 18 – 24".

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/prisma", () => ({
  prisma: { harriPositionDaily: { groupBy: vi.fn() }, store: { findMany: vi.fn() } },
}))
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))
vi.mock("@/lib/counter/labor-cost", () => ({ loadLaborCost: vi.fn() }))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { toQueryBounds } from "@/lib/counter/date-range"
import { getSplhSeries } from "@/app/actions/splh-actions"
import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import { loadLaborCost } from "@/lib/counter/labor-cost"
import { TOTAL_SALES_CODE } from "@/lib/pnl"

/** TARGET_HISTORY_DAYS in splh-actions — the medians' lookback, not a bar. */
const TARGET_HISTORY_DAYS = 56
const DAY_MS = 24 * 60 * 60 * 1000

const session = { user: { id: "u1", accountId: "acct-A", role: "OWNER" } }

/** Counter's range: local midnights, Tue 18 Aug .. Mon 24 Aug 2026. */
const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

/** A row as the raw query returns it — `@db.Date` arrives as a UTC midnight. */
function row(day: string, hours: number, net: number) {
  return {
    storeId: "s1",
    date: new Date(`${day}T00:00:00.000Z`),
    hours,
    cost: hours * 20,
    net,
  }
}

/** Every day from `from` to `to` inclusive, as query rows. */
function daysBetween(from: string, to: string) {
  const out: ReturnType<typeof row>[] = []
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime(); t <= end; t += DAY_MS) {
    out.push(row(new Date(t).toISOString().slice(0, 10), 40, 4000))
  }
  return out
}

type Row = Omit<ReturnType<typeof row>, "net"> & { net: number | null }

/**
 * Feed the three sources `getSplhSeries` joins from the row-shaped fixtures:
 * hours off HarriPositionDaily, labor dollars off `loadLaborCost`, and Net
 * Sales off the statement. A `net: null` row is a day the statement does not
 * price at all.
 */
function feed(rows: Row[]) {
  vi.mocked(prisma.harriPositionDaily.groupBy).mockResolvedValue(
    rows.map((r) => ({
      storeId: r.storeId,
      date: r.date,
      _sum: { actualSeconds: r.hours * 3600 },
    })) as never,
  )
  const byDay: Record<string, { amount: number; source: "daily" }> = {}
  for (const r of rows) {
    byDay[r.date.toISOString().slice(0, 10)] = { amount: r.cost, source: "daily" }
  }
  vi.mocked(loadLaborCost).mockResolvedValue({
    stores: { s1: { storeId: "s1", byDay, total: 0, days: [], missingDays: [] } },
    total: 0,
    missingStoreDays: 0,
  } as never)
  const priced = rows.filter((r) => r.net !== null)
  vi.mocked(getAllStoresPnL).mockResolvedValue({
    periods: priced.map((r) => ({ startDate: r.date })),
    perStore: [
      {
        storeId: "s1",
        rows: [{ code: TOTAL_SALES_CODE, label: "Net Sales", values: priced.map((r) => r.net) }],
      },
    ],
  } as never)
}

/** The where-clause the hours read was made with. */
function hoursWhere(): { date: { gte: Date; lte: Date }; store: unknown } {
  const call = vi.mocked(prisma.harriPositionDaily.groupBy).mock.calls[0]?.[0] as
    | { where: { date: { gte: Date; lte: Date }; store: unknown } }
    | undefined
  if (!call) throw new Error("the hours read never happened")
  return call.where
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue(session as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Hollywood", isActive: true },
  ] as never)
})

describe("getSplhSeries — no range (the behaviour every existing caller has)", () => {
  it("runs the window to today and reads the same bounds from every source", async () => {
    feed(daysBetween("2026-06-01", "2026-08-24"))
    await getSplhSeries("day")
    const w = hoursWhere()
    expect(w.date.lte).toBeInstanceOf(Date)
    expect(w.store).toEqual({ accountId: "acct-A" })
    const sales = vi.mocked(getAllStoresPnL).mock.calls[0][0]
    expect(sales.startDate.getTime()).toBe(w.date.gte.getTime())
    expect(sales.endDate.getTime()).toBe(w.date.lte.getTime())
    expect(sales.granularity).toBe("daily")
    expect(vi.mocked(loadLaborCost).mock.calls[0][0].accountId).toBe("acct-A")
  })

  it("shows a trailing 14 days", async () => {
    feed(
      daysBetween("2026-06-01", "2026-08-24"),
    )
    const [series] = await getSplhSeries("day")
    expect(series.points).toHaveLength(14)
    expect(series.points.at(-1)?.date).toBe("2026-08-24")
  })
})

describe("getSplhSeries — with a range", () => {
  it("binds the range's own bounds, the end one inclusive", async () => {
    const bounds = toQueryBounds(range)
    feed(
      daysBetween("2026-06-01", "2026-08-24"),
    )
    await getSplhSeries("day", bounds)

    const { gte: since, lte: until } = hoursWhere().date

    // The upper bound is `endDate` VERBATIM — 23:59:59 on the range's last
    // day, not a local midnight. Hand a query the raw `end` and the last day
    // of every range disappears; `toQueryBounds` exists for exactly this and
    // the action must not undo it.
    expect(until.getTime()).toBe(bounds.endDate.getTime())
    expect(vi.mocked(getAllStoresPnL).mock.calls[0][0].endDate.getTime()).toBe(bounds.endDate.getTime())

    // The lower bound reaches TARGET_HISTORY_DAYS behind the range's start,
    // because a day is scored against the median of the same weekday before
    // it. Those extra rows are history, never bars — asserted below.
    const expectedSince = new Date(bounds.startDate)
    expectedSince.setUTCDate(expectedSince.getUTCDate() - TARGET_HISTORY_DAYS)
    expect(since.getTime()).toBe(expectedSince.getTime())
  })

  it("bars exactly the range's days — not a trailing 14, and not the history", async () => {
    feed(
      daysBetween("2026-06-01", "2026-08-24"),
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))

    expect(series.points.map((p) => p.date)).toEqual([
      "2026-08-18", "2026-08-19", "2026-08-20",
      "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
    ])
  })

  it("counts coverage over the range, not over the medians' history", async () => {
    feed(
      daysBetween("2026-06-01", "2026-08-24"),
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))
    // 7 days asked about, all of them with hours and sales.
    expect(series.daysCovered).toBe(7)
  })

  it("shows only the weeks that start inside the range", async () => {
    // Mon 3 Aug .. Sun 23 Aug is three whole weeks; the range covers the two
    // that start on the 10th and the 17th.
    feed(
      daysBetween("2026-06-01", "2026-08-23"),
    )
    const [series] = await getSplhSeries("week", {
      startDate: new Date(2026, 7, 10),
      endDate: new Date(2026, 7, 23, 23, 59, 59),
    })
    expect(series.points.map((p) => p.date)).toEqual(["2026-08-10", "2026-08-17"])
  })
})

/* ── A day the sales side never answered ──────────────────────────────── */

describe("getSplhSeries — a day the statement does not price", () => {
  /** `daysBetween`, with one day's sales row absent from the join. */
  function withNullNet(from: string, to: string, missing: string) {
    return daysBetween(from, to).map((r) =>
      r.date.toISOString().slice(0, 10) === missing ? { ...r, net: null } : r,
    )
  }

  it("does not draw a day whose sales are unknown as a day of no sales", async () => {
    feed(
      withNullNet("2026-06-01", "2026-08-24", "2026-08-20"),
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))

    // Reading NULL as $0 gave that day an SPLH of 0, zero earned hours and a
    // variance of every one of the 40 hours worked — the chart's worst day,
    // invented out of a sync gap.
    expect(series.points.map((p) => p.date)).not.toContain("2026-08-20")
    expect(series.points.every((p) => p.splh !== 0)).toBe(true)
    expect(series.daysMissingSales).toBe(1)
    expect(series.daysCovered).toBe(6)
  })

  it("still reports a store whose sales feed missed on EVERY day", async () => {
    // The worst case of the outage `daysMissingSales` exists to surface, and
    // the one case it could not reach: with no priced day the store never
    // landed in `byStore`, so the loop skipped it and the field went with it.
    // The store vanished from the page entirely, which reads as "nothing to
    // report" rather than "this store's sales feed is down".
    const allNull = daysBetween("2026-06-01", "2026-08-24").map((r) => ({
      ...r,
      net: null,
    }))
    feed(allNull)

    const series = await getSplhSeries("day", toQueryBounds(range))
    expect(series).toHaveLength(1)
    expect(series[0].storeId).toBe("s1")
    // Nothing is drawn, because nothing can be priced — but the outage is
    // counted, over the days the caller asked about.
    expect(series[0].points).toEqual([])
    expect(series[0].daysCovered).toBe(0)
    expect(series[0].daysMissingSales).toBeGreaterThan(0)
  })

  it("still skips a store the query returned no rows for at all", async () => {
    // No labour, no sales, no outage to report — that store is simply absent
    // from the window, and an empty card would be noise.
    feed([])
    expect(await getSplhSeries("day", toQueryBounds(range))).toEqual([])
  })

  it("keeps the 0 out of the weekday median every other Thursday is scored on", async () => {
    // 2026-08-13 is a Thursday in the medians' history, not a bar. With its
    // NULL read as 0, that 0 joined the Thursday bucket and dragged the target
    // every real Thursday — including the 20th — is scored against.
    feed(
      withNullNet("2026-06-01", "2026-08-24", "2026-08-13"),
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))
    const thursday = series.points.find((p) => p.weekday === 4)
    // Every scored day here is 4000/40; the target must land on it, not under.
    expect(thursday?.targetSplh).toBe(100)
    expect(thursday?.status).toBe("on")
  })

  it("takes a day's sales from the statement and its dollars from loadLaborCost", async () => {
    const rows = daysBetween("2026-06-01", "2026-08-24")
    feed(rows)
    // The statement's Net Sales is not the old hourly-summary figure.
    vi.mocked(getAllStoresPnL).mockResolvedValue({
      periods: rows.map((r) => ({ startDate: r.date })),
      perStore: [
        {
          storeId: "s1",
          rows: [{ code: TOTAL_SALES_CODE, label: "Net Sales", values: rows.map(() => 3200) }],
        },
      ],
    } as never)
    const [series] = await getSplhSeries("day", toQueryBounds(range))
    // 3200 net over 40 hours, every day.
    expect(series.points.every((p) => p.splh === 80)).toBe(true)
    expect(series.blendedRate).toBe(20)
  })

  it("withholds the whole week rather than drawing one a day's sales short", async () => {
    feed(
      withNullNet("2026-06-01", "2026-08-23", "2026-08-12"),
    )
    const [series] = await getSplhSeries("week", {
      startDate: new Date(2026, 7, 10),
      endDate: new Date(2026, 7, 23, 23, 59, 59),
    })
    // The week of the 10th is six days of sales against seven of labour.
    expect(series.points.map((p) => p.date)).toEqual(["2026-08-17"])
  })
})
