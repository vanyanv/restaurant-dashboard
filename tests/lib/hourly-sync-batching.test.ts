// Batching invariant for the hourly sync write path (2026-06-12 perf audit).
//
// runHourlySync previously ran one delete+insert $transaction per (storeId,
// date) pair — N transactions that scale with stores × days. It must now write
// all pairs in a SINGLE transaction: one deleteMany over the full cross product
// plus one createMany for every bucket.

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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterStore: { findMany: vi.fn() },
    otterHourlySummary: {
      deleteMany: vi.fn((_a: { where: unknown }) => ({ _op: "delete" })),
      createMany: vi.fn((_a: { data: unknown[] }) => ({ _op: "create" })),
    },
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops as unknown[]) : ops,
    ),
  },
}))

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
  vi.mocked(prisma.otterStore.findMany).mockResolvedValue([
    { otterStoreId: UUID_A, storeId: STORE_A, store: { isActive: true } },
    { otterStoreId: UUID_B, storeId: STORE_B, store: { isActive: true } },
  ] as never)
})

describe("runHourlySync — single-transaction write", () => {
  it("writes all (store, date) pairs in one transaction over the full cross product", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([row(UUID_A), row(UUID_B)] as never)

    const result = await runHourlySync({ triggeredBy: "manual" })

    // Exactly one transaction, regardless of stores × days in the window.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.otterHourlySummary.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.otterHourlySummary.createMany).toHaveBeenCalledTimes(1)

    // The single delete spans both stores and every date in the window.
    const deleteArg = vi.mocked(prisma.otterHourlySummary.deleteMany).mock.calls[0]?.[0] as
      | { where: { storeId: { in: string[] }; date: { in: Date[] } } }
      | undefined
    expect(deleteArg).toBeDefined()
    const where = deleteArg!.where
    expect(where.storeId.in).toEqual(expect.arrayContaining([STORE_A, STORE_B]))
    expect(where.date.in.length).toBeGreaterThanOrEqual(2) // default window = 2 days

    expect(result.bucketsWritten).toBe(2)
  })

  it("still issues the clearing delete (and no insert) when no buckets came back", async () => {
    vi.mocked(queryMetrics).mockResolvedValue([] as never)

    const result = await runHourlySync({ triggeredBy: "manual" })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.otterHourlySummary.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.otterHourlySummary.createMany).not.toHaveBeenCalled()
    expect(result.bucketsWritten).toBe(0)
  })
})
