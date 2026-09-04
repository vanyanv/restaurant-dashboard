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
    otterRating: { findMany: vi.fn() },
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
) => ({
  id,
  rating,
  reviewText: null,
  platform: "ubereats",
  reviewedAt,
  storeName: "Hollywood",
  orderItemNames,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getRatingsSummary", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getRatingsSummary()).toBeNull()
  })

  /*
   * NOT null. This asserted null until 2026-09-04, and that is exactly how the
   * Overview came to raise a red `!` and "Guest ratings did not load" on every
   * account nobody had reviewed yet: null is this reader saying it COULD NOT
   * ANSWER, and the caller is entitled to treat that as a failure. An empty
   * table is an answer.
   */
  it("answers with a zero count when the account has no reviews at all", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockResolvedValue([] as never)
    const summary = await getRatingsSummary()
    expect(summary).not.toBeNull()
    expect(summary!.count).toBe(0)
    expect(summary!.average).toBeNull()
    // `stale` means "the window was empty so these are older reviews". There
    // are no reviews at all, so nothing here is stale.
    expect(summary!.stale).toBe(false)
    expect(summary!.recent).toEqual([])
  })

  it("averages the window and counts 1–2 star reviews", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockResolvedValue([
      review("a", 5, daysAgo(1)),
      review("b", 4, daysAgo(2)),
      review("c", 1, daysAgo(3)),
      review("d", 2, daysAgo(4)),
    ] as never)

    const s = await getRatingsSummary()
    expect(s).not.toBeNull()
    expect(s!.stale).toBe(false)
    expect(s!.count).toBe(4)
    expect(s!.average).toBeCloseTo(3, 5)
    expect(s!.lowCount).toBe(2)
    // distribution is 1..5 star at indexes 0..4
    expect(s!.distribution).toEqual([1, 1, 0, 1, 1])
  })

  it("puts the worst reviews first — a 5-star needs no action", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockResolvedValue([
      review("a", 5, daysAgo(1)),
      review("b", 1, daysAgo(2)),
      review("c", 3, daysAgo(3)),
    ] as never)

    const s = await getRatingsSummary()
    expect(s!.recent.map((r) => r.rating)).toEqual([1, 3, 5])
  })

  it("compares the window against the preceding one", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockResolvedValue([
      review("now", 5, daysAgo(1)),
      review("then", 3, daysAgo(40)),
    ] as never)

    const s = await getRatingsSummary()
    expect(s!.deltaVsPrior).toBeCloseTo(2, 5)
  })

  it("falls back to the newest reviews and flags staleness when the window is empty", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    // First call (windowed) finds nothing; fallback call returns old reviews.
    vi.mocked(prisma.otterRating.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        review("old-1", 2, daysAgo(100)),
        review("old-2", 4, daysAgo(101)),
      ] as never)

    const s = await getRatingsSummary()
    expect(s!.stale).toBe(true)
    expect(s!.count).toBe(2)
    // No prior window to compare a stale set against.
    expect(s!.deltaVsPrior).toBeNull()
    expect(s!.latestReviewAt).not.toBeNull()
  })

  it("parses orderItemNames instead of leaking the stored JSON", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockResolvedValue([
      review("a", 1, daysAgo(1), '["Cheese Fries","Slider","Slider"]'),
      review("b", 1, daysAgo(2), '["null"]'),
      review("c", 1, daysAgo(3), null),
    ] as never)

    const s = await getRatingsSummary()
    const byId = Object.fromEntries(s!.recent.map((r) => [r.id, r.orderItems]))
    // de-duplicated, unwrapped
    expect(byId.a).toEqual(["Cheese Fries", "Slider"])
    // Otter's "null" placeholder is not an item
    expect(byId.b).toEqual([])
    expect(byId.c).toEqual([])
  })

  it("never throws — a query failure yields null, not a broken page", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never)
    vi.mocked(prisma.otterRating.findMany).mockRejectedValue(new Error("db down"))
    expect(await getRatingsSummary()).toBeNull()
  })
})
