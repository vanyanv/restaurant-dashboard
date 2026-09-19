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
  prisma: { $queryRaw: vi.fn(), store: { findMany: vi.fn() } },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { toQueryBounds } from "@/lib/counter/date-range"
import { getSplhSeries } from "@/app/actions/splh-actions"

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

/** The Date parameters the query was actually bound with, in order. */
function boundDates(): Date[] {
  const call = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as
    | { values: unknown[] }
    | undefined
  if (!call) throw new Error("$queryRaw was never called")
  return call.values.filter((v): v is Date => v instanceof Date)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue(session as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Hollywood", isActive: true },
  ] as never)
})

describe("getSplhSeries — no range (the behaviour every existing caller has)", () => {
  it("still binds no upper bound, so the window runs to the newest row", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-24") as never,
    )
    await getSplhSeries("day")
    // One `since` per WHERE clause (sales subquery + labor outer), and nothing
    // else. An upper bound would make it four.
    expect(boundDates()).toHaveLength(2)
  })

  it("shows a trailing 14 days", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-24") as never,
    )
    const [series] = await getSplhSeries("day")
    expect(series.points).toHaveLength(14)
    expect(series.points.at(-1)?.date).toBe("2026-08-24")
  })
})

describe("getSplhSeries — with a range", () => {
  it("binds the range's own bounds, the end one inclusive", async () => {
    const bounds = toQueryBounds(range)
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-24") as never,
    )
    await getSplhSeries("day", bounds)

    const dates = boundDates()
    // Two clauses, each `>= since AND <= until`.
    expect(dates).toHaveLength(4)
    const [since, until] = dates

    // The upper bound is `endDate` VERBATIM — 23:59:59 on the range's last
    // day, not a local midnight. Hand a query the raw `end` and the last day
    // of every range disappears; `toQueryBounds` exists for exactly this and
    // the action must not undo it.
    expect(until.getTime()).toBe(bounds.endDate.getTime())
    expect(dates[3].getTime()).toBe(bounds.endDate.getTime())

    // The lower bound reaches TARGET_HISTORY_DAYS behind the range's start,
    // because a day is scored against the median of the same weekday before
    // it. Those extra rows are history, never bars — asserted below.
    const expectedSince = new Date(bounds.startDate)
    expectedSince.setUTCDate(expectedSince.getUTCDate() - TARGET_HISTORY_DAYS)
    expect(since.getTime()).toBe(expectedSince.getTime())
    expect(dates[2].getTime()).toBe(expectedSince.getTime())
  })

  it("bars exactly the range's days — not a trailing 14, and not the history", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-24") as never,
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))

    expect(series.points.map((p) => p.date)).toEqual([
      "2026-08-18", "2026-08-19", "2026-08-20",
      "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
    ])
  })

  it("counts coverage over the range, not over the medians' history", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-24") as never,
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))
    // 7 days asked about, all of them with hours and sales.
    expect(series.daysCovered).toBe(7)
  })

  it("shows only the weeks that start inside the range", async () => {
    // Mon 3 Aug .. Sun 23 Aug is three whole weeks; the range covers the two
    // that start on the 10th and the 17th.
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      daysBetween("2026-06-01", "2026-08-23") as never,
    )
    const [series] = await getSplhSeries("week", {
      startDate: new Date(2026, 7, 10),
      endDate: new Date(2026, 7, 23, 23, 59, 59),
    })
    expect(series.points.map((p) => p.date)).toEqual(["2026-08-10", "2026-08-17"])
  })
})

/* ── A day the sales side never answered ──────────────────────────────── */

describe("getSplhSeries — the LEFT JOIN's misses", () => {
  /** `daysBetween`, with one day's sales row absent from the join. */
  function withNullNet(from: string, to: string, missing: string) {
    return daysBetween(from, to).map((r) =>
      r.date.toISOString().slice(0, 10) === missing ? { ...r, net: null } : r,
    )
  }

  it("does not draw a day whose sales are unknown as a day of no sales", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      withNullNet("2026-06-01", "2026-08-24", "2026-08-20") as never,
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
    vi.mocked(prisma.$queryRaw).mockResolvedValue(allNull as never)

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
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    expect(await getSplhSeries("day", toQueryBounds(range))).toEqual([])
  })

  it("keeps the 0 out of the weekday median every other Thursday is scored on", async () => {
    // 2026-08-13 is a Thursday in the medians' history, not a bar. With its
    // NULL read as 0, that 0 joined the Thursday bucket and dragged the target
    // every real Thursday — including the 20th — is scored against.
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      withNullNet("2026-06-01", "2026-08-24", "2026-08-13") as never,
    )
    const [series] = await getSplhSeries("day", toQueryBounds(range))
    const thursday = series.points.find((p) => p.weekday === 4)
    // Every scored day here is 4000/40; the target must land on it, not under.
    expect(thursday?.targetSplh).toBe(100)
    expect(thursday?.status).toBe("on")
  })

  it("withholds the whole week rather than drawing one a day's sales short", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue(
      withNullNet("2026-06-01", "2026-08-23", "2026-08-12") as never,
    )
    const [series] = await getSplhSeries("week", {
      startDate: new Date(2026, 7, 10),
      endDate: new Date(2026, 7, 23, 23, 59, 59),
    })
    // The week of the 10th is six days of sales against seven of labour.
    expect(series.points.map((p) => p.date)).toEqual(["2026-08-17"])
  })
})
