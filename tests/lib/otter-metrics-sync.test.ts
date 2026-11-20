// Scoping invariant: when runMetricsSyncForStore is called with storeId="A",
// it must NEVER write/upsert/touch rows belonging to any other store. This
// is the load-bearing safety check for the per-store matrix workflow —
// without it, one matrix shard could clobber another store's data.
//
// We mock both Prisma and the Otter HTTP layer. Mocked queryMetrics returns
// fake rows tagged with BOTH storeA's UUID and a foreign UUID; the runner's
// internal `otterUuidSet.has()` filter must drop the foreign rows. We then
// inspect every prisma call's args and assert nothing leaked.
//
// Since 2026-11-20 the phases write with one change-only
// INSERT ... ON CONFLICT ... WHERE IS DISTINCT FROM per chunk
// (`@/lib/upsert-changed`), so the writes are `$executeRaw` calls whose bound
// values we inspect, and `changed` is what the database said it wrote.

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
type RawSql = { sql: string; values: unknown[] }
// What the database "reports" for each raw write. Default: every row changed.
let executeRawImpl: (sql: RawSql) => Promise<number> = async () => 1

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
      $executeRaw: vi.fn((sql: { sql: string; values: unknown[] }) => {
        prismaCalls.push({ method: "$executeRaw", args: sql })
        return executeRawImpl(sql)
      }),
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
import { runMetricsSyncForStore, totalChangedRows } from "@/lib/otter-metrics-sync"
import * as otter from "@/lib/otter"

const STORE_A = "store-A-id"
const STORE_B = "store-B-id"
const UUID_A = "uuid-A1"
const UUID_B = "uuid-B1" // foreign — must never make it into a write

beforeEach(() => {
  prismaCalls.length = 0
  executeRawImpl = async () => 1
  vi.clearAllMocks()
})

const rawWrites = () =>
  prismaCalls.filter((c) => c.method === "$executeRaw").map((c) => c.args as RawSql)
const writesTo = (table: string) =>
  rawWrites().filter((w) => w.sql.includes(`INSERT INTO "${table}"`))

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

    // ── Invariant 1: every write is scoped to STORE_A ──
    const writes = rawWrites()
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) {
      expect(w.sql).toMatch(/IS DISTINCT FROM/)
      expect(w.values).toContain(STORE_A)
      expect(w.values).not.toContain(STORE_B)
      // the foreign row's figure never reaches a write
      expect(w.values).not.toContain(999)
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

    expect(writesTo("OtterMenuItem")).toHaveLength(0)
    expect(writesTo("OtterMenuCategory")).toHaveLength(0)
    expect(writesTo("OtterRating")).toHaveLength(0)
  })
})

describe("runMetricsSyncForStore — writes only what changed", () => {
  const windowStart = new Date("2026-05-01T00:00:00.000Z")
  const windowEnd = new Date("2026-05-01T23:59:59.999Z")

  function mockAllPhases() {
    vi.mocked(otter.queryMetrics).mockResolvedValue([
      {
        store: UUID_A,
        eod_date_with_timezone: "2026-05-01",
        pos_summary_ofo: "css-pos",
        multi_value_pos_payment_method: "CARD",
        fp_sales_financials_gross_sales: 100,
        menu_parent_entity_name: "Sliders",
        item: "Classic",
        fp_order_items_quantity_sold: 3,
      },
    ])
    vi.mocked(otter.queryRatings).mockResolvedValue([
      { external_review_id: "r1", order_rating: 5, order_reviewed_at: "2026-05-01T12:00:00Z" },
      // Same review twice: one statement cannot upsert a key twice, so the
      // runner keeps the last one.
      { external_review_id: "r1", order_rating: 4, order_reviewed_at: "2026-05-01T12:00:00Z" },
    ])
  }

  it("issues one change-only statement per phase, not a transaction of per-row upserts", async () => {
    mockAllPhases()
    await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      includeRatings: true,
    })
    expect(prismaCalls.filter((c) => c.method.endsWith(".upsert"))).toHaveLength(0)
    expect(writesTo("OtterDailySummary")).toHaveLength(1)
    expect(writesTo("OtterMenuCategory")).toHaveLength(1)
    // items + modifiers share the table, distinguished by isModifier
    const menuItemWrites = writesTo("OtterMenuItem")
    expect(menuItemWrites).toHaveLength(2)
    expect(menuItemWrites[0].values).toContain(false)
    expect(menuItemWrites[1].values).toContain(true)
    for (const w of menuItemWrites) {
      expect(w.sql).toContain(`ON CONFLICT ("storeId", "date", "category", "itemName", "isModifier")`)
    }
    const ratingWrites = writesTo("OtterRating")
    expect(ratingWrites).toHaveLength(1)
    expect(ratingWrites[0].values.filter((v) => v === "r1")).toHaveLength(1)
    expect(ratingWrites[0].values).toContain(4)
  })

  it("reports synced rows separately from rows the database actually changed", async () => {
    mockAllPhases()
    // Nothing changed except the daily row.
    executeRawImpl = async (sql) => (sql.sql.includes(`INSERT INTO "OtterDailySummary"`) ? 1 : 0)
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      includeRatings: true,
    })
    expect(result.daily).toEqual({ synced: 1, failed: 0, changed: 1 })
    expect(result.items).toEqual({ synced: 1, failed: 0, changed: 0 })
    expect(result.ratings).toEqual({ synced: 1, failed: 0, changed: 0 })
    expect(totalChangedRows(result)).toBe(1)
  })

  it("reports zero changed when a re-run finds the window already current", async () => {
    mockAllPhases()
    executeRawImpl = async () => 0
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      includeRatings: true,
    })
    expect(totalChangedRows(result)).toBe(0)
    expect(result.items.synced).toBe(1)
  })

  it("counts a failing statement as failed and carries on with the next phase", async () => {
    mockAllPhases()
    executeRawImpl = async (sql) => {
      if (sql.sql.includes(`INSERT INTO "OtterMenuCategory"`)) throw new Error("boom")
      return 1
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
    })
    spy.mockRestore()
    expect(result.categories).toEqual({ synced: 0, failed: 1, changed: 0 })
    expect(result.items).toEqual({ synced: 1, failed: 0, changed: 1 })
  })
})
