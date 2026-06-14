// Contract tests for the monitoring queries that back /dashboard/monitoring*
// and /m/monitoring, written ahead of the queries.ts domain split so the move
// can't drift behavior. They import from @/lib/monitoring/queries — the path
// that becomes the re-export shim — and pin merge order, flag thresholds,
// bigint coercion and grid keying.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    jobRun: { findFirst: vi.fn(), findMany: vi.fn() },
    errorEvent: { findMany: vi.fn(), count: vi.fn() },
    loginEvent: { findMany: vi.fn() },
    store: { findMany: vi.fn() },
    otterOrder: { groupBy: vi.fn() },
    otterStore: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  getErrorsByHour,
  getAiCostByHour,
  getLoginsByHour,
  getBridgeEvents,
  getRecentActivity,
  getSyncsByStore,
  getPendingOrderDetails,
  getStaleStores,
} from "@/lib/monitoring/queries"
import { resolveWindow } from "@/lib/monitoring/time-range"

const NOW = new Date("2026-06-12T12:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.jobRun.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.jobRun.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.loginEvent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterOrder.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.otterStore.findMany).mockResolvedValue([] as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("hourly bucket rollups (mobile sparklines)", () => {
  it("getErrorsByHour coerces bigint counts to numbers", async () => {
    const bucket = new Date("2026-06-12T10:00:00Z")
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ bucket, count: BigInt(7) }] as never)
    expect(await getErrorsByHour(24)).toEqual([{ bucket, count: 7 }])
  })

  it("getAiCostByHour coerces cost and defaults null to 0", async () => {
    const bucket = new Date("2026-06-12T10:00:00Z")
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { bucket, cost: 1.25 },
      { bucket, cost: null },
    ] as never)
    expect(await getAiCostByHour(24)).toEqual([
      { bucket, cost: 1.25 },
      { bucket, cost: 0 },
    ])
  })

  it("getLoginsByHour splits succeeded/failed as numbers", async () => {
    const bucket = new Date("2026-06-12T10:00:00Z")
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { bucket, succeeded: BigInt(3), failed: BigInt(1) },
    ] as never)
    expect(await getLoginsByHour(24)).toEqual([{ bucket, succeeded: 3, failed: 1 }])
  })
})

describe("TimeWindow support (global range control)", () => {
  // A TimeWindow arg must bound the query on BOTH ends — the legacy numeric
  // arg only ever bounded `since`. We assert both bounds reach $queryRaw.
  function datesPassedToQuery(): Date[] {
    return vi
      .mocked(prisma.$queryRaw)
      .mock.calls[0]!.slice(1)
      .filter((v): v is Date => v instanceof Date)
  }

  it("getErrorsByHour threads window.since and window.until into the query", async () => {
    const w = resolveWindow("7d")
    await getErrorsByHour(w)
    const dates = datesPassedToQuery()
    expect(dates).toContainEqual(w.since)
    expect(dates).toContainEqual(w.until)
  })

  it("getAiCostByHour threads window.since and window.until into the query", async () => {
    const w = resolveWindow("7d")
    await getAiCostByHour(w)
    const dates = datesPassedToQuery()
    expect(dates).toContainEqual(w.since)
    expect(dates).toContainEqual(w.until)
  })

  it("getLoginsByHour threads window.since and window.until into the query", async () => {
    const w = resolveWindow("7d")
    await getLoginsByHour(w)
    const dates = datesPassedToQuery()
    expect(dates).toContainEqual(w.since)
    expect(dates).toContainEqual(w.until)
  })
})

describe("getBridgeEvents", () => {
  it("merges syncs + errors + logins desc by occurredAt, capped at limit, with kind prefixes and failure flags", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue([
      { id: "j1", startedAt: new Date("2026-06-12T11:00:00Z"), jobName: "otter.metrics.sync", status: "FAILURE", errorMessage: "boom", rowsWritten: null },
      { id: "j2", startedAt: new Date("2026-06-12T08:00:00Z"), jobName: "cogs.sweep", status: "SUCCESS", errorMessage: null, rowsWritten: 42 },
    ] as never)
    vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([
      { id: "e1", occurredAt: new Date("2026-06-12T10:00:00Z"), source: "api", route: "/api/chat", message: "oops", status: 500 },
    ] as never)
    vi.mocked(prisma.loginEvent.findMany).mockResolvedValue([
      { id: "l1", createdAt: new Date("2026-06-12T09:00:00Z"), emailTried: "a@b.c", kind: "SIGN_IN_FAILED", ipAddress: "1.2.3.4" },
    ] as never)

    const rows = await getBridgeEvents(3)
    expect(rows.map((r) => r.id)).toEqual(["sync-j1", "err-e1", "login-l1"])
    expect(rows[0]).toMatchObject({
      kind: "sync",
      system: "syncs",
      isFailure: true,
      description: "otter.metrics.sync failed — boom",
    })
    expect(rows[1]).toMatchObject({
      kind: "error",
      isFailure: true,
      description: "/api/chat 500 — oops",
    })
    expect(rows[2]).toMatchObject({
      kind: "login",
      system: "auth",
      isFailure: true,
      description: "Failed sign-in for a@b.c from 1.2.3.4",
    })
  })
})

describe("getRecentActivity", () => {
  it("merges syncs + errors desc and formats status detail with row counts", async () => {
    vi.mocked(prisma.jobRun.findMany).mockResolvedValue([
      { id: "j1", startedAt: new Date("2026-06-12T11:00:00Z"), jobName: "cogs.sweep", status: "SUCCESS", rowsWritten: 12, errorMessage: null },
    ] as never)
    vi.mocked(prisma.errorEvent.findMany).mockResolvedValue([
      { id: "e1", occurredAt: new Date("2026-06-12T11:30:00Z"), source: "api", route: null, message: "x".repeat(200) },
    ] as never)

    const rows = await getRecentActivity(5)
    expect(rows.map((r) => r.id)).toEqual(["err-e1", "sync-j1"])
    expect(rows[0]).toMatchObject({ kind: "error", label: "api", isFailure: true })
    expect(rows[0].detail).toHaveLength(120)
    expect(rows[1]).toMatchObject({ kind: "sync", detail: "success · 12 rows", isFailure: false })
  })
})

describe("getSyncsByStore", () => {
  it("keys cells by storeId|jobName, falls back to global rows, and flags threshold breaches", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "Hollywood" },
    ] as never)
    vi.mocked(prisma.jobRun.findFirst).mockImplementation((async (args: unknown) => {
      const where = (args as { where: { jobName: string; storeId: string | null } }).where
      // store-scoped metrics run breaching the 45s duration threshold
      if (where.jobName === "otter.metrics.sync" && where.storeId === "s1") {
        return { startedAt: new Date("2026-06-12T11:00:00Z"), status: "SUCCESS", rowsWritten: 100, durationMs: 50_000 } as never
      }
      // orders job only has a GLOBAL row (storeId null) breaching 4000 rows
      if (where.jobName === "otter.orders.sync" && where.storeId === null) {
        return { startedAt: new Date("2026-06-12T10:00:00Z"), status: "SUCCESS", rowsWritten: 5000, durationMs: 1_000 } as never
      }
      return null as never
    }) as never)

    const grid = await getSyncsByStore()
    expect(grid.stores).toEqual([{ storeId: "s1", storeName: "Hollywood", isActive: true }])
    expect(grid.jobNames).toEqual([
      "otter.metrics.sync",
      "otter.orders.sync",
      "otter.hourly.sync",
      "otter.orders.drain",
      "cogs.sweep",
    ])

    const metrics = grid.cells["s1|otter.metrics.sync"]
    expect(metrics).toMatchObject({ flagged: true, flagReason: "50.0s > 45s", durationMs: 50_000 })

    const orders = grid.cells["s1|otter.orders.sync"]
    expect(orders).toMatchObject({ flagged: true, flagReason: "5000 rows > 4000", rowsWritten: 5000 })

    const hourly = grid.cells["s1|otter.hourly.sync"]
    expect(hourly).toMatchObject({ lastRunAt: null, status: null, flagged: false, flagReason: null })
  })
})

describe("getPendingOrderDetails", () => {
  it("flags growing backlogs (today > yesterday) per active store", async () => {
    vi.mocked(prisma.otterOrder.groupBy)
      .mockResolvedValueOnce([{ storeId: "s1", _count: { _all: 5 } }] as never) // today
      .mockResolvedValueOnce([{ storeId: "s1", _count: { _all: 3 } }] as never) // yesterday
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      { id: "s1", name: "Hollywood" },
      { id: "s2", name: "Glendale" },
    ] as never)

    expect(await getPendingOrderDetails()).toEqual([
      { storeId: "s1", storeName: "Hollywood", pending: 5, growing: true },
      { storeId: "s2", storeName: "Glendale", pending: 0, growing: false },
    ])
  })
})

describe("getStaleStores", () => {
  it("merges multiple Otter UUIDs per store (latest sync wins) and flags stale/never-synced", async () => {
    const fresh = new Date(NOW.getTime() - 30 * 60_000) // 30min ago
    const older = new Date(NOW.getTime() - 5 * 3_600_000)
    vi.mocked(prisma.otterStore.findMany).mockResolvedValue([
      { storeId: "s1", lastSyncAt: older, store: { id: "s1", name: "Hollywood", isActive: true } },
      { storeId: "s1", lastSyncAt: fresh, store: { id: "s1", name: "Hollywood", isActive: true } },
      { storeId: "s2", lastSyncAt: null, store: { id: "s2", name: "Glendale", isActive: true } },
      { storeId: "s3", lastSyncAt: fresh, store: { id: "s3", name: "Closed", isActive: false } },
    ] as never)

    const rows = await getStaleStores(90)
    expect(rows).toEqual([
      { storeId: "s1", storeName: "Hollywood", lastSyncAt: fresh, ageMinutes: 30, isStale: false },
      { storeId: "s2", storeName: "Glendale", lastSyncAt: null, ageMinutes: null, isStale: true },
    ])
  })
})
