// getRatingsSummary — the first reader for OtterRating, a table that had been
// written and read by nothing. Two behaviours matter beyond the arithmetic:
// it must degrade to the newest available reviews (and say so) when the sync
// has gone stale, and it must not leak the raw JSON that orderItemNames is
// stored as.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterRating: { findMany: vi.fn(), groupBy: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"

const session = { user: { id: "u1", accountId: "acct-A" } }

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

const review = (
  id: string,
  rating: number,
  reviewedAt: Date,
  orderItemNames: string | null = null,
  platform = "ubereats",
) => ({
  id,
  rating,
  reviewText: null,
  platform,
  reviewedAt,
  storeName: "Hollywood",
  orderItemNames,
})


type Row = ReturnType<typeof review>
type Where = { reviewedAt?: { gte?: Date; lte?: Date; lt?: Date } }

/**
 * A table the mocked client reads: `where` on reviewedAt, `orderBy`, `take`
 * and `groupBy` with counts and max, evaluated over `rows`. The account/store
 * filter is asserted separately; every row here is the account's.
 */
function table(rows: Row[]) {
  const inWhere = (r: Row, w?: Where) => {
    const d = w?.reviewedAt
    if (!d) return true
    return (!d.gte || r.reviewedAt >= d.gte) && (!d.lte || r.reviewedAt <= d.lte) && (!d.lt || r.reviewedAt < d.lt)
  }
  vi.mocked(prisma.otterRating.findMany).mockImplementation((async (args: {
    where?: Where
    orderBy?: Array<Record<string, "asc" | "desc">> | Record<string, "asc" | "desc">
    take?: number
  }) => {
    const order = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : []
    const out = rows.filter((r) => inWhere(r, args.where)).sort((a, b) => {
      for (const o of order) {
        const [k, dir] = Object.entries(o)[0]
        const av = (a as never)[k] as number | Date
        const bv = (b as never)[k] as number | Date
        if (av < bv) return dir === "asc" ? -1 : 1
        if (av > bv) return dir === "asc" ? 1 : -1
      }
      return 0
    })
    return args.take ? out.slice(0, args.take) : out
  }) as never)
  vi.mocked(prisma.otterRating.groupBy).mockImplementation((async (args: { by: Array<keyof Row>; where?: Where }) => {
    const by = new Map<string, Record<string, unknown>>()
    for (const r of rows.filter((x) => inWhere(x, args.where))) {
      const key = args.by.map((k) => String(r[k])).join("|")
      const g = by.get(key) ?? {
        ...Object.fromEntries(args.by.map((k) => [k, r[k]])),
        _count: { _all: 0 },
        _max: { reviewedAt: null as Date | null },
      }
      ;(g._count as { _all: number })._all += 1
      const m = g._max as { reviewedAt: Date | null }
      if (m.reviewedAt === null || r.reviewedAt > m.reviewedAt) m.reviewedAt = r.reviewedAt
      by.set(key, g)
    }
    return [...by.values()]
  }) as never)
}

/** The computation as it was when every review of both windows was loaded. */
function reference(rows: Row[], windowDays: number, now: Date) {
  const start = new Date(now.getTime() - windowDays * 86_400_000)
  const priorStart = new Date(start.getTime() - windowDays * 86_400_000)
  const all = rows.filter((r) => r.reviewedAt >= priorStart && r.reviewedAt <= now).sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())
  const current = all.filter((r) => r.reviewedAt >= start)
  const prior = all.filter((r) => r.reviewedAt < start)
  const mean = (v: number[]) => (v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length)
  const distribution = [0, 0, 0, 0, 0]
  for (const r of current) distribution[Math.min(4, Math.max(0, r.rating - 1))] += 1
  const totals = new Map<string, { count: number; sum: number }>()
  for (const r of current) {
    const k = r.platform || "unknown"
    const a = totals.get(k) ?? { count: 0, sum: 0 }
    a.count += 1
    a.sum += r.rating
    totals.set(k, a)
  }
  const average = mean(current.map((r) => r.rating))
  const priorAverage = mean(prior.map((r) => r.rating))
  return {
    count: current.length,
    average,
    lowCount: current.filter((r) => r.rating <= 2).length,
    distribution,
    byPlatform: [...totals.entries()]
      .map(([platform, a]) => ({ platform, count: a.count, average: a.sum / a.count }))
      .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
    deltaVsPrior: average != null && priorAverage != null ? average - priorAverage : null,
    latestReviewAt: current[0]?.reviewedAt ?? null,
    recentRatings: [...current]
      .sort((a, b) => (a.rating !== b.rating ? a.rating - b.rating : b.reviewedAt.getTime() - a.reviewedAt.getTime()))
      .slice(0, 6)
      .map((r) => r.id),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getRatingsSummary", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getRatingsSummary()).toBeNull()
  })

  // NOT null: an empty table is an answer (see the reader's own comment).
  it("answers with a zero count when the account has no reviews at all", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([])
    const summary = await getRatingsSummary()
    expect(summary).not.toBeNull()
    expect(summary!.count).toBe(0)
    expect(summary!.average).toBeNull()
    expect(summary!.stale).toBe(false)
    expect(summary!.recent).toEqual([])
  })

  it("averages the window and counts 1–2 star reviews", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([review("a", 5, daysAgo(1)), review("b", 4, daysAgo(2)), review("c", 1, daysAgo(3)), review("d", 2, daysAgo(4))])
    const s = await getRatingsSummary()
    expect(s!.stale).toBe(false)
    expect(s!.count).toBe(4)
    expect(s!.average).toBeCloseTo(3, 5)
    expect(s!.lowCount).toBe(2)
    expect(s!.distribution).toEqual([1, 1, 0, 1, 1])
  })

  it("puts the worst reviews first — a 5-star needs no action", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([review("a", 5, daysAgo(1)), review("b", 1, daysAgo(2)), review("c", 3, daysAgo(3))])
    const s = await getRatingsSummary()
    expect(s!.recent.map((r) => r.rating)).toEqual([1, 3, 5])
  })

  it("compares the window against the preceding one", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([review("now", 5, daysAgo(1)), review("then", 3, daysAgo(40))])
    const s = await getRatingsSummary()
    expect(s!.deltaVsPrior).toBeCloseTo(2, 5)
  })

  it("falls back to the newest reviews and flags staleness when the window is empty", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([review("old-1", 2, daysAgo(100)), review("old-2", 4, daysAgo(101))])
    const s = await getRatingsSummary()
    expect(s!.stale).toBe(true)
    expect(s!.count).toBe(2)
    expect(s!.average).toBe(3)
    expect(s!.lowCount).toBe(1)
    expect(s!.recent.map((r) => r.id)).toEqual(["old-1", "old-2"])
    expect(s!.deltaVsPrior).toBeNull()
    expect(s!.latestReviewAt).not.toBeNull()
  })

  it("parses orderItemNames instead of leaking the stored JSON", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([
      review("a", 1, daysAgo(1), '["Cheese Fries","Slider","Slider"]'),
      review("b", 1, daysAgo(2), '["null"]'),
      review("c", 1, daysAgo(3), null),
    ])
    const s = await getRatingsSummary()
    const byId = Object.fromEntries(s!.recent.map((r) => [r.id, r.orderItems]))
    expect(byId.a).toEqual(["Cheese Fries", "Slider"])
    expect(byId.b).toEqual([])
    expect(byId.c).toEqual([])
  })

  it("never throws — a query failure yields null, not a broken page", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockRejectedValue(new Error("db down"))
    vi.mocked(prisma.otterRating.groupBy).mockRejectedValue(new Error("db down"))
    expect(await getRatingsSummary()).toBeNull()
  })

  it("equals the all-rows computation on a busy window, and loads only six rows", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    const platforms = ["ubereats", "doordash", "", "grubhub"]
    const rows: Row[] = Array.from({ length: 150 }, (_, i) =>
      review(`r${i}`, ((i * 7) % 5) + 1, daysAgo((i % 58) + 0.25 + (i % 3) * 0.01), null, platforms[i % 4]),
    )
    table(rows)
    const now = new Date()
    const s = await getRatingsSummary()
    const ref = reference(rows, 30, now)
    expect(s!.count).toBe(ref.count)
    expect(s!.average).toBe(ref.average)
    expect(s!.lowCount).toBe(ref.lowCount)
    expect(s!.distribution).toEqual(ref.distribution)
    expect(s!.byPlatform).toEqual(ref.byPlatform)
    expect(s!.deltaVsPrior).toBe(ref.deltaVsPrior)
    expect(s!.latestReviewAt).toEqual(ref.latestReviewAt)
    expect(s!.recent.map((r) => r.id)).toEqual(ref.recentRatings)
    // Counts are grouped reads; the only row read carries `take: 6`.
    const reads = vi.mocked(prisma.otterRating.findMany).mock.calls
    expect(reads).toHaveLength(1)
    expect(reads[0][0]).toMatchObject({ take: 6 })
  })

  it("scopes every read to the account's active stores", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    table([review("a", 5, daysAgo(1))])
    await getRatingsSummary({ storeId: "s1" })
    const wheres = [
      ...vi.mocked(prisma.otterRating.findMany).mock.calls.map((c) => c[0]?.where),
      ...vi.mocked(prisma.otterRating.groupBy).mock.calls.map((c) => (c[0] as { where?: unknown }).where),
    ]
    for (const w of wheres) {
      expect(w).toMatchObject({ store: { accountId: "acct-A", isActive: true, id: "s1" } })
    }
  })
})
