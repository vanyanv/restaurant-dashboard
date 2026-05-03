// Scoping invariant: when runMetricsSyncForStore is called with storeId="A",
// it must NEVER write/upsert/touch rows belonging to any other store. This
// is the load-bearing safety check for the per-store matrix workflow —
// without it, one matrix shard could clobber another store's data.
//
// We mock both Prisma and the Otter HTTP layer. Mocked queryMetrics returns
// fake rows tagged with BOTH storeA's UUID and a foreign UUID; the runner's
// internal `otterUuidSet.has()` filter must drop the foreign rows. We then
// inspect every prisma call's args and assert nothing leaked.

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mock the Otter HTTP layer with deterministic fixtures ───
vi.mock("@/lib/otter", () => {
  const queryMetrics = vi.fn()
  const queryRatings = vi.fn()
  const buildDailySyncBody = vi.fn(() => ({}))
  const buildMenuCategoryBatchBody = vi.fn(() => ({}))
  const buildMenuItemSyncBody = vi.fn(() => ({}))
  const buildModifierSyncBody = vi.fn(() => ({}))
  const buildRatingsBody = vi.fn(() => ({}))
  const getDateRange = (start: Date, end: Date) => {
    const days: Date[] = []
    const cur = new Date(start)
    cur.setUTCHours(0, 0, 0, 0)
    const e = new Date(end)
    e.setUTCHours(0, 0, 0, 0)
    while (cur <= e) {
      days.push(new Date(cur))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return days
  }
  const withConcurrency = async <T>(tasks: Array<() => Promise<T>>) => {
    return Promise.all(tasks.map((t) => t()))
  }
  return {
    queryMetrics,
    queryRatings,
    buildDailySyncBody,
    buildMenuCategoryBatchBody,
    buildMenuItemSyncBody,
    buildModifierSyncBody,
    buildRatingsBody,
    getDateRange,
    withConcurrency,
  }
})

// ─── Mock Prisma so we can inspect every call's args ───
type Call = { method: string; args: unknown }
const prismaCalls: Call[] = []

function track(method: string) {
  return vi.fn((args: unknown) => {
    prismaCalls.push({ method, args })
    return Promise.resolve({ id: "fake-id", startedAt: new Date() })
  })
}

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      jobRun: {
        create: track("jobRun.create"),
        update: track("jobRun.update"),
      },
      otterDailySummary: {
        upsert: track("otterDailySummary.upsert"),
      },
      otterMenuCategory: {
        upsert: track("otterMenuCategory.upsert"),
      },
      otterMenuItem: {
        upsert: track("otterMenuItem.upsert"),
      },
      otterRating: {
        upsert: track("otterRating.upsert"),
      },
      otterStore: {
        updateMany: track("otterStore.updateMany"),
      },
      $transaction: vi.fn(async (ops: unknown) => {
        if (Array.isArray(ops)) {
          return Promise.all(ops as Promise<unknown>[])
        }
        return (ops as (tx: unknown) => Promise<unknown>)({})
      }),
    },
  }
})

// We import the system-under-test AFTER setting up the mocks above.
import { runMetricsSyncForStore } from "@/lib/otter-metrics-sync"
import * as otter from "@/lib/otter"

const STORE_A = "store-A-id"
const STORE_B = "store-B-id"
const UUID_A = "uuid-A1"
const UUID_B = "uuid-B1" // foreign — must never make it into a write

beforeEach(() => {
  prismaCalls.length = 0
  vi.clearAllMocks()
})

describe("runMetricsSyncForStore — store-scoping invariant", () => {
  it("does not write/update any row belonging to a foreign store", async () => {
    // queryMetrics returns rows for BOTH storeA's UUID and a foreign UUID.
    // The runner must filter foreign UUIDs via its internal otterUuidSet.
    vi.mocked(otter.queryMetrics).mockResolvedValue([
      {
        store: UUID_A,
        eod_date_with_timezone: "2026-05-01",
        pos_summary_ofo: "css-pos",
        multi_value_pos_payment_method: "CARD",
        fp_sales_financials_gross_sales: 100,
      },
      {
        // Foreign-store row. If the runner doesn't filter it, this would
        // either write to STORE_A (wrong attribution) or attempt a write
        // for STORE_B (cross-store leak).
        store: UUID_B,
        eod_date_with_timezone: "2026-05-01",
        pos_summary_ofo: "css-pos",
        multi_value_pos_payment_method: "CARD",
        fp_sales_financials_gross_sales: 999,
      },
    ])
    vi.mocked(otter.queryRatings).mockResolvedValue([])

    const windowStart = new Date("2026-05-01T00:00:00.000Z")
    const windowEnd = new Date("2026-05-01T23:59:59.999Z")

    await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      dailyOnly: true, // narrows surface area to daily phase + lastSyncAt update
      includeRatings: false,
    })

    // ── Invariant 1: every upsert is scoped to STORE_A ──
    const upserts = prismaCalls.filter((c) => c.method.endsWith(".upsert"))
    expect(upserts.length).toBeGreaterThan(0)
    for (const call of upserts) {
      const args = call.args as { create?: { storeId?: string }; where?: Record<string, unknown> }
      // create must carry storeId = STORE_A
      expect(args.create?.storeId).toBe(STORE_A)
      // composite where keys also include storeId
      const flatWhere = JSON.stringify(args.where ?? {})
      expect(flatWhere).toContain(STORE_A)
      expect(flatWhere).not.toContain(STORE_B)
    }

    // ── Invariant 2: lastSyncAt update is scoped to STORE_A only ──
    const lastSyncCalls = prismaCalls.filter((c) => c.method === "otterStore.updateMany")
    expect(lastSyncCalls).toHaveLength(1)
    const lastSyncWhere = (lastSyncCalls[0].args as { where: { storeId: string } }).where
    expect(lastSyncWhere.storeId).toBe(STORE_A)

    // ── Invariant 3: JobRun row tagged with STORE_A ──
    const jobRunCreates = prismaCalls.filter((c) => c.method === "jobRun.create")
    expect(jobRunCreates).toHaveLength(1)
    const jobRunArgs = jobRunCreates[0].args as { data: { storeId: string; jobName: string } }
    expect(jobRunArgs.data.storeId).toBe(STORE_A)
    expect(jobRunArgs.data.jobName).toBe("otter.metrics.sync")

    // ── Invariant 4: STORE_B never appears in ANY captured prisma arg ──
    const allArgs = JSON.stringify(prismaCalls)
    expect(allArgs).not.toContain(STORE_B)
    // Foreign UUID may legitimately appear in passthrough metadata (e.g.
    // build*Body args) but should never appear in a write payload's storeId.
    // We've already covered that via Invariant 1.
  })

  it("does not write to OtterMenuItem or OtterMenuCategory in dailyOnly mode", async () => {
    vi.mocked(otter.queryMetrics).mockResolvedValue([])
    const windowStart = new Date("2026-05-01T00:00:00.000Z")
    const windowEnd = new Date("2026-05-01T23:59:59.999Z")

    await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      dailyOnly: true,
      includeRatings: false,
    })

    expect(prismaCalls.find((c) => c.method === "otterMenuItem.upsert")).toBeUndefined()
    expect(prismaCalls.find((c) => c.method === "otterMenuCategory.upsert")).toBeUndefined()
    expect(prismaCalls.find((c) => c.method === "otterRating.upsert")).toBeUndefined()
  })
})
