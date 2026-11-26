/**
 * The COGS sweep job, moved out of its two API routes so the GitHub Actions
 * runner can run it (`scripts/sweep-cogs.ts`). These pin what the routes did
 * before the move: which stores are listed, the source-change skip, the
 * JobRun rows, and that saved figures are retired only for days a sweep
 * actually rewrote.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma-retry", () => ({ withPrismaRetry: <T>(fn: () => Promise<T>) => fn() }))
vi.mock("@/lib/monitoring/job-alerts", () => ({ evaluateJobAlert: vi.fn(async () => {}) }))

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findFirst: vi.fn() },
  jobRun: {
    create: vi.fn(async () => ({ id: "jr1", startedAt: new Date() })),
    update: vi.fn(async () => ({})),
  },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

const recompute = vi.hoisted(() => vi.fn())
vi.mock("@/lib/cogs-materializer", () => ({ recomputeDailyCogsForRange: recompute }))

const gate = vi.hoisted(() => vi.fn())
vi.mock("@/lib/cogs-sweep-gate", () => ({ shouldSkipCogsSweep: gate }))

const bumps = vi.hoisted(() => ({
  bumpDays: vi.fn(async (_dates: string[]) => {}),
  bumpClosedGeneration: vi.fn(async () => {}),
}))
vi.mock("@/lib/cache/closed-range", async (orig) => {
  const real = await orig<typeof import("@/lib/cache/closed-range")>()
  return {
    ...real,
    // The real withScopedWrites, with its two bumps observed.
    withScopedWrites: async <T,>(dates: () => string[], fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } finally {
        let written: string[] | null
        try {
          written = dates()
        } catch {
          written = null
        }
        if (written === null) await bumps.bumpClosedGeneration()
        else await bumps.bumpDays(written)
      }
    },
  }
})

import {
  CogsSweepFailedError,
  CogsSweepStoreNotFoundError,
  isValidCogsLookback,
  listCogsSweepStores,
  runCogsSweepForStore,
} from "@/lib/cogs-sweep-job"

const STORE = { id: "s1", name: "Hollywood", accountId: "acct1" }

beforeEach(() => {
  vi.clearAllMocks()
  db.store.findFirst.mockResolvedValue(STORE)
  gate.mockResolvedValue({ shouldSkip: false, reason: null, sourceChangedAt: null, lastSuccessfulSweepAt: null })
  recompute.mockResolvedValue({ daysProcessed: 3, rowsUpserted: 40, rowsDeleted: 1, rowsChanged: 5 })
})

describe("isValidCogsLookback", () => {
  it("accepts 1 to 365 and nothing else", () => {
    expect([1, 3, 30, 365].every(isValidCogsLookback)).toBe(true)
    expect([0, -1, 366, Number.NaN, Number.POSITIVE_INFINITY].some(isValidCogsLookback)).toBe(false)
  })
})

describe("listCogsSweepStores", () => {
  const ACTIVE = [
    { id: "s-a", name: "Alpha", accountId: "a", _count: { otterMenuItems: 12, otterOrders: 0 } },
    { id: "s-b", name: "Bravo", accountId: "a", _count: { otterMenuItems: 0, otterOrders: 7 } },
    { id: "s-c", name: "Charlie", accountId: "a", _count: { otterMenuItems: 0, otterOrders: 0 } },
  ]

  beforeEach(() => db.store.findMany.mockResolvedValue(ACTIVE))

  it("leaves out a store with no menu items and no orders", async () => {
    const r = await listCogsSweepStores({ force: false, triggeredBy: "github-actions" })
    expect(r.stores).toEqual([
      { id: "s-a", name: "Alpha", accountId: "a" },
      { id: "s-b", name: "Bravo", accountId: "a" },
    ])
    expect(r).toMatchObject({ activeStoreCount: 3, skippedEmptyStoreCount: 1, force: false })
  })

  it("lists every active store when forced", async () => {
    const r = await listCogsSweepStores({ force: true, triggeredBy: "github-actions" })
    expect(r.stores.map((s) => s.id)).toEqual(["s-a", "s-b", "s-c"])
    expect(r.skippedEmptyStoreCount).toBe(0)
  })

  it("asks only for active stores, by name, and records a cogs.stores run", async () => {
    await listCogsSweepStores({ force: false, triggeredBy: "github-actions" })
    expect(db.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true }, orderBy: { name: "asc" } }),
    )
    expect(db.jobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobName: "cogs.stores", triggeredBy: "github-actions" }),
      }),
    )
  })
})

describe("runCogsSweepForStore", () => {
  const run = (over: Partial<Parameters<typeof runCogsSweepForStore>[0]> = {}) =>
    runCogsSweepForStore({ storeId: "s1", lookbackDays: 3, force: false, triggeredBy: "github-actions", ...over })

  it("recomputes the window ending today (UTC midnight) and reports the rows", async () => {
    const r = await run()
    expect(r).toEqual({
      storeId: "s1",
      storeName: "Hollywood",
      lookbackDays: 3,
      force: false,
      skipped: false,
      skipReason: null,
      sourceChangedAt: null,
      lastSuccessfulSweepAt: null,
      daysProcessed: 3,
      rowsUpserted: 40,
      rowsDeleted: 1,
      rowsChanged: 5,
    })
    const call = recompute.mock.calls[0][0]
    expect(call).toMatchObject({ storeId: "s1", accountId: "acct1" })
    const end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    expect(call.endDate.toISOString()).toBe(end.toISOString())
    expect(end.getTime() - call.startDate.getTime()).toBe(3 * 86_400_000)
  })

  it("records a cogs.sweep run for the store with the caller's trigger", async () => {
    await run({ triggeredBy: "github-actions" })
    expect(db.jobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobName: "cogs.sweep",
          storeId: "s1",
          triggeredBy: "github-actions",
          metadata: { lookbackDays: 3, force: false, skipPolicy: "source-change" },
        }),
      }),
    )
  })

  it("retires the saved figures of the days it rewrote", async () => {
    await run()
    expect(bumps.bumpDays).toHaveBeenCalledTimes(1)
    const days = bumps.bumpDays.mock.calls[0][0]
    expect(days.length).toBeGreaterThanOrEqual(3)
    expect(bumps.bumpClosedGeneration).not.toHaveBeenCalled()
  })

  it("retires nothing when the recompute changed no row", async () => {
    recompute.mockResolvedValue({ daysProcessed: 3, rowsUpserted: 40, rowsDeleted: 0, rowsChanged: 0 })
    await run()
    expect(bumps.bumpDays).toHaveBeenCalledWith([])
  })

  it("skips when the source has not changed: no recompute, nothing retired, reason on the run", async () => {
    const sourceChangedAt = new Date("2026-11-25T10:00:00Z")
    const lastSuccessfulSweepAt = new Date("2026-11-25T12:00:00Z")
    gate.mockResolvedValue({ shouldSkip: true, reason: "no-source-change", sourceChangedAt, lastSuccessfulSweepAt })
    const r = await run()
    expect(recompute).not.toHaveBeenCalled()
    expect(r).toMatchObject({
      skipped: true,
      skipReason: "no-source-change",
      sourceChangedAt: sourceChangedAt.toISOString(),
      lastSuccessfulSweepAt: lastSuccessfulSweepAt.toISOString(),
      rowsUpserted: 0,
      rowsChanged: 0,
    })
    expect(bumps.bumpDays).toHaveBeenCalledWith([])
    expect(db.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "jr1" },
        data: {
          metadata: expect.objectContaining({ skipped: true, skipReason: "no-source-change" }),
        },
      }),
    )
  })

  it("does not consult the skip when forced", async () => {
    await run({ force: true })
    expect(gate).not.toHaveBeenCalled()
    expect(recompute).toHaveBeenCalledTimes(1)
  })

  it("refuses an unknown or inactive store before writing any run", async () => {
    db.store.findFirst.mockResolvedValue(null)
    await expect(run({ storeId: "gone" })).rejects.toBeInstanceOf(CogsSweepStoreNotFoundError)
    expect(db.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "gone", isActive: true } }),
    )
    expect(db.jobRun.create).not.toHaveBeenCalled()
    expect(recompute).not.toHaveBeenCalled()
  })

  it("refuses a lookback outside 1 to 365 before reading anything", async () => {
    await expect(run({ lookbackDays: 0 })).rejects.toBeInstanceOf(RangeError)
    await expect(run({ lookbackDays: 400 })).rejects.toBeInstanceOf(RangeError)
    expect(db.store.findFirst).not.toHaveBeenCalled()
  })

  it("wraps a failed recompute with the store it was for, and marks the run failed", async () => {
    recompute.mockRejectedValue(new Error("deadlock detected"))
    const err = await run().then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(CogsSweepFailedError)
    expect((err as CogsSweepFailedError).storeId).toBe("s1")
    expect((err as CogsSweepFailedError).message).toBe("deadlock detected")
    expect(db.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILURE" }) }),
    )
  })
})
