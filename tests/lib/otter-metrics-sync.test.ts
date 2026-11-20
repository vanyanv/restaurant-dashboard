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
      // upserts are change-only; the reconcile DELETE is scoped to the store
      if (w.sql.includes("DELETE FROM")) {
        expect(w.sql).toContain(`t."storeId" = `)
      } else {
        expect(w.sql).toMatch(/IS DISTINCT FROM/)
      }
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
    expect(result.daily).toEqual({ synced: 1, failed: 0, changed: 1, removed: 0, fetchFailed: 0 })
    expect(result.items).toEqual({ synced: 1, failed: 0, changed: 0, removed: 0, fetchFailed: 0 })
    expect(result.ratings).toEqual({ synced: 1, failed: 0, changed: 0, removed: 0, fetchFailed: 0 })
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
    // The phase's upserts and its reconcile DELETE share one transaction, so
    // a failing statement fails the whole phase (nothing half-replaced).
    expect(result.categories).toEqual({ synced: 0, failed: 1, changed: 0, removed: 0, fetchFailed: 0 })
    expect(result.items).toEqual({ synced: 1, failed: 0, changed: 1, removed: 1, fetchFailed: 0 })
    expect(result.problems).toEqual(["categories: 1 rows failed to write"])
  })
})

describe("runMetricsSyncForStore — reconciles what Otter stopped returning", () => {
  const windowStart = new Date("2026-05-01T00:00:00.000Z")
  const windowEnd = new Date("2026-05-02T23:59:59.999Z")
  const deletesFrom = (table: string) =>
    rawWrites().filter((w) => w.sql.includes(`DELETE FROM "${table}"`))
  const jobRunStatuses = () =>
    prismaCalls
      .filter((c) => c.method === "jobRun.update")
      .map((c) => (c.args as { data: { status?: string } }).data.status)
      .filter(Boolean)

  beforeEach(() => {
    vi.mocked(otter.queryRatings).mockResolvedValue([])
  })

  it("deletes stale rows per phase for the fetched dates, in one transaction with the upserts", async () => {
    vi.mocked(otter.queryMetrics).mockResolvedValue([
      {
        store: UUID_A,
        eod_date_with_timezone: "2026-05-01",
        pos_summary_ofo: "css-pos",
        multi_value_pos_payment_method: "CARD",
        menu_parent_entity_name: "Sliders",
        item: "Classic",
        fp_order_items_quantity_sold: 3,
      },
    ])
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
      includeRatings: true,
    })

    for (const table of ["OtterDailySummary", "OtterMenuCategory"]) {
      const [del] = deletesFrom(table)
      expect(del, table).toBeDefined()
      expect(del.sql).toContain("NOT EXISTS")
      expect(del.values).toContain(STORE_A)
    }
    // The daily request covers the window and only 05-01 came back with rows,
    // so only 05-01 is reconciled; a day with no rows is never wiped.
    expect(deletesFrom("OtterDailySummary")[0].values).toContainEqual(["2026-05-01"])
    // Categories are fetched per day and both days answered with a row.
    expect(deletesFrom("OtterMenuCategory")[0].values).toContainEqual(["2026-05-01", "2026-05-02"])
    // items and modifiers each reconcile only their own half of the table
    const menuDeletes = deletesFrom("OtterMenuItem")
    expect(menuDeletes).toHaveLength(2)
    expect(menuDeletes[0].values).toContain(false)
    expect(menuDeletes[1].values).toContain(true)
    // the kept keys travel as arrays: the Classic row on both days survives
    expect(menuDeletes[0].values).toContainEqual(["Classic", "Classic"])
    // ratings are individual reviews: never reconciled
    expect(deletesFrom("OtterRating")).toHaveLength(0)
    // every upsert + delete pair went through a transaction
    const { prisma } = await import("@/lib/prisma")
    expect(prisma.$transaction).toHaveBeenCalledTimes(4)
    expect(result.problems).toEqual([])
    expect(jobRunStatuses()).toEqual(["SUCCESS"])
  })

  it("counts removed rows as changes", async () => {
    vi.mocked(otter.queryMetrics).mockResolvedValue([
      { store: UUID_A, menu_parent_entity_name: "Sliders", item: "Classic", fp_order_items_quantity_sold: 1 },
    ])
    executeRawImpl = async (sql) => (sql.sql.includes(`DELETE FROM "OtterMenuCategory"`) ? 4 : 0)
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "manual",
    })
    expect(result.categories.removed).toBe(4)
    expect(totalChangedRows(result)).toBe(4)
  })

  it("never reconciles a day whose fetch failed, and records the run PARTIAL", async () => {
    // Categories: day 1 fails, day 2 answers.
    vi.mocked(otter.buildMenuCategoryBatchBody)
      .mockReturnValueOnce({ phase: "cat", day: 1 })
      .mockReturnValueOnce({ phase: "cat", day: 2 })
    vi.mocked(otter.queryMetrics).mockImplementation(async (body: object) => {
      const b = body as { phase?: string; day?: number }
      if (b.phase === "cat" && b.day === 1) throw new Error("Otter API error 503")
      if (b.phase === "cat") return [{ store: UUID_A, menu_parent_entity_name: "Sliders" }]
      return []
    })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "cron",
      includeRatings: true,
    })
    spy.mockRestore()

    const [catDelete] = deletesFrom("OtterMenuCategory")
    expect(catDelete.values).toContainEqual(["2026-05-02"])
    expect(JSON.stringify(catDelete.values)).not.toContain("2026-05-01")
    expect(result.categories.fetchFailed).toBe(1)
    expect(result.problems.join(" ")).toMatch(/categories: fetch failed for 1\/2 days \(2026-05-01\)/)

    // Not SUCCESS, so it can never stand in for the scheduled sync.
    expect(jobRunStatuses()).toEqual(["PARTIAL"])
    const metaUpdate = prismaCalls.find(
      (c) => c.method === "jobRun.update" && (c.args as { data: { metadata?: unknown } }).data.metadata,
    )
    expect(
      (metaUpdate!.args as { data: { metadata: { problems: string[] } } }).data.metadata.problems,
    ).toHaveLength(1)
    // lastSyncAt does not move for an incomplete run
    expect(prismaCalls.filter((c) => c.method === "otterStore.updateMany")).toHaveLength(0)
  })

  it("does not wipe a day that a clean fetch answered with no rows", async () => {
    vi.mocked(otter.queryMetrics).mockResolvedValue([])
    await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, { triggeredBy: "cron" })
    for (const table of ["OtterDailySummary", "OtterMenuCategory", "OtterMenuItem"]) {
      for (const del of deletesFrom(table)) {
        expect(JSON.stringify(del.values), table).not.toContain("2026-05-0")
      }
    }
  })

  it("treats a failed ratings fetch as a failure", async () => {
    vi.mocked(otter.queryMetrics).mockResolvedValue([])
    vi.mocked(otter.queryRatings).mockRejectedValue(new Error("timeout"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "cron",
      includeRatings: true,
    })
    spy.mockRestore()
    expect(result.ratings.fetchFailed).toBe(1)
    expect(jobRunStatuses()).toEqual(["PARTIAL"])
  })

  it("treats a response at its row cap as truncated: not written, not reconciled", async () => {
    vi.mocked(otter.buildMenuItemSyncBody)
      .mockReturnValueOnce({ phase: "item", limit: 1 })
      .mockReturnValueOnce({ phase: "item", limit: 1 })
    vi.mocked(otter.queryMetrics).mockImplementation(async (body: object) =>
      (body as { phase?: string }).phase === "item"
        ? [{ menu_parent_entity_name: "Sliders", item: "Classic", fp_order_items_quantity_sold: 1 }]
        : [],
    )
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runMetricsSyncForStore(STORE_A, [UUID_A], windowStart, windowEnd, {
      triggeredBy: "cron",
    })
    spy.mockRestore()
    expect(result.items.fetchFailed).toBe(2)
    expect(result.items.synced).toBe(0)
    expect(deletesFrom("OtterMenuItem").find((d) => d.values.includes(false))).toBeUndefined()
    expect(jobRunStatuses()).toEqual(["PARTIAL"])
  })
})

describe("runMetricsSyncForStore — a store with two Otter UUIDs", () => {
  it("adds the two UUIDs' category rows instead of keeping the last", async () => {
    const UUID_A2 = "uuid-A2"
    vi.mocked(otter.queryRatings).mockResolvedValue([])
    vi.mocked(otter.buildMenuCategoryBatchBody).mockReturnValueOnce({ phase: "cat" })
    vi.mocked(otter.queryMetrics).mockImplementation(async (body: object) =>
      (body as { phase?: string }).phase === "cat"
        ? [
            { store: UUID_A, menu_parent_entity_name: "Sliders", fp_order_items_total_sales: 100, fp_order_items_quantity_sold: 10 },
            { store: UUID_A2, menu_parent_entity_name: "Sliders", fp_order_items_total_sales: 40, fp_order_items_quantity_sold: 4 },
          ]
        : [],
    )
    const result = await runMetricsSyncForStore(
      STORE_A,
      [UUID_A, UUID_A2],
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-01T23:59:59.999Z"),
      { triggeredBy: "manual" },
    )
    expect(result.categories.synced).toBe(1)
    const [catWrite] = writesTo("OtterMenuCategory")
    expect(catWrite.values).toContain(140)
    expect(catWrite.values).toContain(14)
    expect(catWrite.values).not.toContain(40)
  })
})
