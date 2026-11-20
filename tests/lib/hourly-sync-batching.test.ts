// Batching invariant for the hourly sync write path (2026-06-12 perf audit).
//
// runHourlySync previously ran one delete+insert $transaction per (storeId,
// date) pair — N transactions that scale with stores × days. It must write all
// pairs in a SINGLE transaction.
//
// Since 2026-11-20 that transaction no longer deletes and re-inserts the whole
// window every hour: it upserts the buckets with a change-only
// INSERT ... ON CONFLICT ... WHERE IS DISTINCT FROM, then deletes only the
// window's buckets that disappeared. `bucketsChanged` is what the database
// reports, and the route gates its cache busts on it.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/otter", () => ({
  queryMetrics: vi.fn(),
  buildCustomerOrdersBody: vi.fn(() => ({})),
}))

vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(
    async (
      _name: string,
      _opts: unknown,
      fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<unknown>,
    ) => fn({ jobRunId: "jr", addRows: () => {} }),
  ),
}))

type RawSql = { sql: string; values: unknown[] }
const raw: RawSql[] = []
let affected: (sql: RawSql) => number = () => 0

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterStore: { findMany: vi.fn() },
    $executeRaw: vi.fn((sql: RawSql) => {
      raw.push(sql)
      return Promise.resolve(affected(sql))
    }),
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops as unknown[]) : ops,
    ),
  },
}))

const upserts = () => raw.filter((r) => r.sql.includes(`INSERT INTO "OtterHourlySummary"`))
const deletes = () => raw.filter((r) => r.sql.includes(`DELETE FROM "OtterHourlySummary"`))

import { prisma } from "@/lib/prisma"
import { queryMetrics } from "@/lib/otter"
import { todayInLA } from "@/lib/dashboard-utils"
import { runHourlySync } from "@/lib/hourly-sync"

const UUID_A = "uuid-A"
const UUID_B = "uuid-B"
const STORE_A = "store-A"
const STORE_B = "store-B"

// Local-encoded epoch whose UTC date equals today's LA date and hour = 12,
// so the row falls inside the window the sync clears.
const todayEpoch = Date.parse(`${todayInLA()}T12:00:00.000Z`)

function row(otterStoreId: string) {
  return {
    store_id: otterStoreId,
    reference_time_local_without_tz: todayEpoch,
    subtotal: 20,
    restaurant_funded_discount: 0,
    ofo_funded_discount: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  raw.length = 0
  affected = () => 0
  vi.mocked(prisma.otterStore.findMany).mockResolvedValue([
    { otterStoreId: UUID_A, storeId: STORE_A, store: { isActive: true } },
    { otterStoreId: UUID_B, storeId: STORE_B, store: { isActive: true } },
  ] as never)
})

describe("runHourlySync — single-transaction, change-only write", () => {
  it("reconciles all (store, date) pairs in one transaction over the full cross product", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([row(UUID_A), row(UUID_B)] as never)

    const result = await runHourlySync({ triggeredBy: "manual" })

    // Exactly one transaction, regardless of stores × days in the window.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(upserts()).toHaveLength(1)
    expect(deletes()).toHaveLength(1)

    const upsert = upserts()[0]
    expect(upsert.sql).toContain(`ON CONFLICT ("storeId", "date", "hour")`)
    expect(upsert.sql).toMatch(/IS DISTINCT FROM/)
    expect(upsert.values).toEqual(expect.arrayContaining([STORE_A, STORE_B, 12, 1, 20]))

    // The delete spans both stores and every date in the window, and keeps
    // the buckets that were just upserted.
    const del = deletes()[0]
    expect(del.values).toEqual(expect.arrayContaining([STORE_A, STORE_B, todayInLA()]))
    expect(del.values.filter((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)).length)
      .toBeGreaterThanOrEqual(2) // default window = 2 days
    expect(del.sql).toContain("NOT IN")

    expect(result.bucketsWritten).toBe(2)
  })

  it("reports no change when the window is already current", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([row(UUID_A), row(UUID_B)] as never)
    affected = () => 0

    const result = await runHourlySync({ triggeredBy: "manual" })

    expect(result.bucketsWritten).toBe(2)
    expect(result.bucketsChanged).toBe(0)
  })

  it("counts upserted and deleted buckets as changed", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([row(UUID_A)] as never)
    affected = (sql) => (sql.sql.includes("DELETE") ? 3 : 1)

    const result = await runHourlySync({ triggeredBy: "manual" })

    expect(result.bucketsChanged).toBe(4)
  })

  it("still issues the clearing delete (and no upsert) when no buckets came back", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([] as never)

    const result = await runHourlySync({ triggeredBy: "manual" })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(deletes()).toHaveLength(1)
    expect(deletes()[0].sql).not.toContain("NOT IN")
    expect(upserts()).toHaveLength(0)
    expect(result.bucketsWritten).toBe(0)
  })
})
