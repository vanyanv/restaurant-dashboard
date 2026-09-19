/*
 * Contract tests for the three tools added 2026-09-19. Prisma is mocked, so
 * what is under test is the part a query cannot be trusted to do for us: the
 * store scope reaching `assertOwnerOwnsStores`, the shapes the model is
 * handed, and the two judgement calls the linter cannot see — that an empty
 * alert inbox says whether it is muted, and that forecast accuracy is always
 * reported against its baseline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))

import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import { getRatings } from "@/lib/chat/tools/ratings"
import { getAlerts } from "@/lib/chat/tools/alerts"
import { getForecastQuality } from "@/lib/chat/tools/forecast-quality"
import type { ChatToolContext } from "@/lib/chat/tools/types"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertOwnerOwnsStores).mockImplementation(async (_a, ids) => ids ?? ["s1", "s2"])
})

function ctx(prisma: Record<string, unknown>): ChatToolContext {
  return { ownerId: "u1", accountId: "acct-A", prisma: prisma as never }
}

const RANGE = { from: "2026-09-01", to: "2026-09-30" }

function rating(over: Partial<Record<string, unknown>> = {}) {
  return {
    rating: 5,
    reviewText: "great",
    platform: "DoorDash",
    reviewedAt: new Date("2026-09-10T18:00:00Z"),
    storeName: "Hollywood",
    orderItemNames: '["Double Slider"]',
    ...over,
  }
}

describe("getRatings", () => {
  it("scopes through assertOwnerOwnsStores, never through a model-supplied id", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await getRatings.execute(
      { storeIds: ["s1"], dateRange: RANGE, view: "summary", limit: 15 },
      ctx({ otterRating: { findMany } }),
    )
    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s1"])
    expect(findMany.mock.calls[0][0].where.storeId).toEqual({ in: ["s1"] })
  })

  it("reaches the end of the last day, not its midnight", async () => {
    // `reviewedAt` is a timestamp. Querying `lte: 2026-09-30T00:00:00Z` drops
    // every review left after midnight on the final day of the range.
    const findMany = vi.fn().mockResolvedValue([])
    await getRatings.execute(
      { dateRange: RANGE, view: "summary", limit: 15 },
      ctx({ otterRating: { findMany } }),
    )
    const { gte, lte } = findMany.mock.calls[0][0].where.reviewedAt
    expect(gte.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(lte.getTime()).toBe(new Date("2026-10-01T00:00:00.000Z").getTime() - 1)
  })

  it("summarises the distribution, the mean and the low-star count", async () => {
    const rows = [rating({ rating: 5 }), rating({ rating: 1 }), rating({ rating: 4 })]
    const result = await getRatings.execute(
      { dateRange: RANGE, view: "summary", limit: 15 },
      ctx({ otterRating: { findMany: vi.fn().mockResolvedValue(rows) } }),
    )
    if (result.view !== "summary") throw new Error("expected the summary view")
    expect(result.summary.count).toBe(3)
    expect(result.summary.average).toBeCloseTo(10 / 3)
    expect(result.summary.lowCount).toBe(1)
    expect(result.summary.distribution).toEqual([1, 0, 0, 1, 1])
  })

  it("splits by platform, because a blended mean hides a fulfilment problem", async () => {
    const rows = [
      rating({ platform: "DoorDash", rating: 5 }),
      rating({ platform: "DoorDash", rating: 5 }),
      rating({ platform: "UberEats", rating: 2 }),
    ]
    const result = await getRatings.execute(
      { dateRange: RANGE, view: "summary", limit: 15 },
      ctx({ otterRating: { findMany: vi.fn().mockResolvedValue(rows) } }),
    )
    if (result.view !== "summary") throw new Error("expected the summary view")
    expect(result.summary.byPlatform).toEqual([
      { platform: "DoorDash", count: 2, average: 5 },
      { platform: "UberEats", count: 1, average: 2 },
    ])
  })

  it("returns an honest empty summary rather than a null", async () => {
    const result = await getRatings.execute(
      { dateRange: RANGE, view: "summary", limit: 15 },
      ctx({ otterRating: { findMany: vi.fn().mockResolvedValue([]) } }),
    )
    if (result.view !== "summary") throw new Error("expected the summary view")
    expect(result.summary).toMatchObject({
      count: 0,
      average: null,
      latestReviewAt: null,
      distribution: [0, 0, 0, 0, 0],
    })
  })

  it("orders reviews worst first and parses the items the guest ordered", async () => {
    const rows = [
      rating({ rating: 5, orderItemNames: '["Fries","null","Fries"]' }),
      rating({ rating: 1, orderItemNames: null }),
      rating({ rating: 3 }),
    ]
    const result = await getRatings.execute(
      { dateRange: RANGE, view: "reviews", limit: 15 },
      ctx({ otterRating: { findMany: vi.fn().mockResolvedValue(rows) } }),
    )
    if (result.view !== "reviews") throw new Error("expected the reviews view")
    expect(result.reviews.map((r) => r.rating)).toEqual([1, 3, 5])
    // Otter writes the literal string "null" for an unknown line, and repeats
    // an item that was ordered twice.
    expect(result.reviews[2].orderItems).toEqual(["Fries"])
    expect(result.reviews[0].orderItems).toEqual([])
  })

  it("applies maxRating in the query, not after the cap", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await getRatings.execute(
      { dateRange: RANGE, view: "reviews", maxRating: 2, limit: 5 },
      ctx({ otterRating: { findMany } }),
    )
    expect(findMany.mock.calls[0][0].where.rating).toEqual({ lte: 2 })
  })

  it("does not filter by rating in the summary view", async () => {
    // A distribution computed from only the one-star reviews is not a
    // distribution. maxRating belongs to the review list alone.
    const findMany = vi.fn().mockResolvedValue([])
    await getRatings.execute(
      { dateRange: RANGE, view: "summary", maxRating: 2, limit: 15 },
      ctx({ otterRating: { findMany } }),
    )
    expect(findMany.mock.calls[0][0].where.rating).toBeUndefined()
  })

  it("honours the limit on the review list", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => rating({ rating: (i % 5) + 1 }))
    const result = await getRatings.execute(
      { dateRange: RANGE, view: "reviews", limit: 3 },
      ctx({ otterRating: { findMany: vi.fn().mockResolvedValue(rows) } }),
    )
    if (result.view !== "reviews") throw new Error("expected the reviews view")
    expect(result.reviews).toHaveLength(3)
  })
})

function alert(over: Partial<Record<string, unknown>> = {}) {
  return {
    source: "ANOMALY_EVENT",
    target: "REVENUE",
    targetId: null,
    severity: "WATCH",
    status: "OPEN",
    title: "Revenue below expected",
    body: null,
    explanation: null,
    occurredOn: new Date("2026-09-15T00:00:00Z"),
    detectedAt: new Date("2026-09-15T06:00:00Z"),
    store: { name: "Hollywood" },
    ...over,
  }
}

function alertCtx(alerts: unknown[], prefs: unknown[] = []) {
  return ctx({
    alert: { findMany: vi.fn().mockResolvedValue(alerts) },
    alertPreference: { findMany: vi.fn().mockResolvedValue(prefs) },
  })
}

describe("getAlerts", () => {
  it("defaults to the open inbox and scopes to owned stores", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const c = ctx({
      alert: { findMany },
      alertPreference: { findMany: vi.fn().mockResolvedValue([]) },
    })
    await getAlerts.execute({ status: "OPEN", sinceDays: 30, limit: 25 }, c)
    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", null)
    expect(findMany.mock.calls[0][0].where.status).toBe("OPEN")
    expect(findMany.mock.calls[0][0].where.storeId).toEqual({ in: ["s1", "s2"] })
  })

  it("'any' asks for no status at all rather than a literal 'any'", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await getAlerts.execute(
      { status: "any", sinceDays: 30, limit: 25 },
      ctx({
        alert: { findMany },
        alertPreference: { findMany: vi.fn().mockResolvedValue([]) },
      }),
    )
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined()
  })

  it("counts every severity across the whole match, not just the returned page", async () => {
    const rows = [
      ...Array.from({ length: 30 }, () => alert({ severity: "INFO" })),
      alert({ severity: "CRITICAL" }),
    ]
    const result = await getAlerts.execute(
      { status: "OPEN", sinceDays: 30, limit: 5 },
      alertCtx(rows),
    )
    expect(result.alerts).toHaveLength(5)
    expect(result.counts).toEqual({ critical: 1, watch: 0, info: 30, total: 31 })
  })

  it("puts the critical ones first whatever their date", async () => {
    const rows = [
      alert({ severity: "INFO", occurredOn: new Date("2026-09-18T00:00:00Z") }),
      alert({ severity: "CRITICAL", occurredOn: new Date("2026-09-01T00:00:00Z") }),
    ]
    const result = await getAlerts.execute(
      { status: "OPEN", sinceDays: 30, limit: 25 },
      alertCtx(rows),
    )
    expect(result.alerts[0].severity).toBe("CRITICAL")
  })

  it("filters below the requested minimum severity", async () => {
    const rows = [alert({ severity: "INFO" }), alert({ severity: "CRITICAL" })]
    const result = await getAlerts.execute(
      { status: "OPEN", severity: "WATCH", sinceDays: 30, limit: 25 },
      alertCtx(rows),
    )
    expect(result.counts.total).toBe(1)
    expect(result.alerts[0].severity).toBe("CRITICAL")
  })

  it("says an empty inbox is muted when it is", async () => {
    // "Nothing is wrong" and "you turned the alarm off" are different answers.
    const result = await getAlerts.execute(
      { status: "OPEN", sinceDays: 30, limit: 25 },
      alertCtx([], [{ muted: true, minSeverity: "INFO", storeId: null, target: null }]),
    )
    expect(result.counts.total).toBe(0)
    expect(result.mutedByPreference).toBe(true)
  })

  it("treats a raised floor as a mute for the severity being asked about", async () => {
    const result = await getAlerts.execute(
      { status: "OPEN", sinceDays: 30, limit: 25 },
      alertCtx([], [{ muted: false, minSeverity: "CRITICAL", storeId: "s1", target: null }]),
    )
    expect(result.mutedByPreference).toBe(true)
  })

  it("does not call a WATCH question muted by an INFO floor", async () => {
    const result = await getAlerts.execute(
      { status: "OPEN", severity: "WATCH", sinceDays: 30, limit: 25 },
      alertCtx([], [{ muted: false, minSeverity: "INFO", storeId: null, target: null }]),
    )
    expect(result.mutedByPreference).toBe(false)
  })

  it("keeps the account-wide default preference when a target is named", async () => {
    // A preference row with a null target applies to every subject, and is the
    // row most likely to be the reason an inbox looks empty.
    const result = await getAlerts.execute(
      { status: "OPEN", target: "PRICE", sinceDays: 30, limit: 25 },
      alertCtx([], [{ muted: true, minSeverity: "INFO", storeId: null, target: null }]),
    )
    expect(result.mutedByPreference).toBe(true)
  })

  it("ignores a preference for a different subject", async () => {
    const result = await getAlerts.execute(
      { status: "OPEN", target: "PRICE", sinceDays: 30, limit: 25 },
      alertCtx([], [{ muted: true, minSeverity: "INFO", storeId: null, target: "LABOR" }]),
    )
    expect(result.mutedByPreference).toBe(false)
  })

  it("reads preferences on the account, never on a model-supplied id", async () => {
    const prefFind = vi.fn().mockResolvedValue([])
    await getAlerts.execute(
      { status: "OPEN", sinceDays: 30, limit: 25 },
      ctx({
        alert: { findMany: vi.fn().mockResolvedValue([]) },
        alertPreference: { findMany: prefFind },
      }),
    )
    expect(prefFind.mock.calls[0][0].where.accountId).toBe("acct-A")
  })
})

function evaluation(over: Partial<Record<string, unknown>> = {}) {
  return {
    target: "REVENUE",
    modelVersion: "v3",
    windowStart: new Date("2026-09-01T00:00:00Z"),
    windowEnd: new Date("2026-09-14T00:00:00Z"),
    wape: 0.12,
    mape: 0.14,
    mae: 310,
    bias: -40,
    intervalCoverage80: 0.79,
    intervalCoverage95: 0.94,
    baselineWape: 0.2,
    sampleSize: 14,
    staleRowCount: 0,
    computedAt: new Date("2026-09-15T08:00:00Z"),
    store: { name: "Hollywood" },
    ...over,
  }
}

function qualityCtx(evals: unknown[], runs: unknown[] = []) {
  return ctx({
    mlForecastEvaluation: { findMany: vi.fn().mockResolvedValue(evals) },
    mlTrainingRun: { findMany: vi.fn().mockResolvedValue(runs) },
  })
}

describe("getForecastQuality", () => {
  it("answers 'can I trust it' against the baseline, not in the abstract", async () => {
    const result = await getForecastQuality.execute({ limit: 12 }, qualityCtx([evaluation()]))
    expect(result.evaluations[0].beatsBaseline).toBe(true)
    expect(result.evaluations[0].baselineWape).toBe(0.2)
  })

  it("says no when the model loses to same-day-last-week", async () => {
    const result = await getForecastQuality.execute(
      { limit: 12 },
      qualityCtx([evaluation({ wape: 0.25, baselineWape: 0.2 })]),
    )
    expect(result.evaluations[0].beatsBaseline).toBe(false)
  })

  it("a missing baseline is 'unknown', not a tie", async () => {
    const result = await getForecastQuality.execute(
      { limit: 12 },
      qualityCtx([evaluation({ baselineWape: null })]),
    )
    expect(result.evaluations[0].beatsBaseline).toBeNull()
  })

  it("returns an empty list rather than implying the model is fine", async () => {
    const result = await getForecastQuality.execute({ limit: 12 }, qualityCtx([]))
    expect(result.evaluations).toEqual([])
    expect(result.recentTrainingRuns).toEqual([])
  })

  it("scopes training runs to this account's store ids, since the model has no join", async () => {
    const runFind = vi.fn().mockResolvedValue([])
    await getForecastQuality.execute(
      { limit: 12 },
      ctx({
        mlForecastEvaluation: { findMany: vi.fn().mockResolvedValue([]) },
        mlTrainingRun: { findMany: runFind },
      }),
    )
    // A run scoped "global" is fitted across every account's data, so it is
    // deliberately not reachable from here.
    expect(runFind.mock.calls[0][0].where.scope).toEqual({ in: ["s1", "s2"] })
  })

  it("scopes evaluations by store", async () => {
    const evalFind = vi.fn().mockResolvedValue([])
    await getForecastQuality.execute(
      { storeIds: ["s2"], limit: 12 },
      ctx({
        mlForecastEvaluation: { findMany: evalFind },
        mlTrainingRun: { findMany: vi.fn().mockResolvedValue([]) },
      }),
    )
    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s2"])
    expect(evalFind.mock.calls[0][0].where.storeId).toEqual({ in: ["s2"] })
  })

  it("carries a failed training run's error message through", async () => {
    const result = await getForecastQuality.execute(
      { limit: 12 },
      qualityCtx([], [
        {
          target: "REVENUE",
          modelType: "xgboost",
          status: "FAILED",
          startedAt: new Date("2026-09-19T09:00:00Z"),
          completedAt: null,
          mape: null,
          sampleSize: null,
          modelVersion: null,
          errorMessage: "not enough history",
        },
      ]),
    )
    expect(result.recentTrainingRuns[0]).toMatchObject({
      status: "FAILED",
      errorMessage: "not enough history",
      completedAt: null,
    })
  })
})
