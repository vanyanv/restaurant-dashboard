import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    jobRun: { findFirst: vi.fn() },
    otterHourlySummary: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { loadElapsedCompare } from "@/lib/counter/adapters/elapsed-compare"

const WED = new Date(2026, 10, 18)
const now = new Date("2026-11-18T11:20:00-08:00")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "h" }] as never)
  vi.mocked(prisma.jobRun.findFirst).mockResolvedValue({ startedAt: now } as never)
  vi.mocked(prisma.otterHourlySummary.findFirst).mockResolvedValue({ date: new Date("2026-11-18T00:00:00Z"), hour: 11 } as never)
  vi.mocked(prisma.otterHourlySummary.findMany).mockResolvedValue([
    { storeId: "h", date: new Date("2026-11-18T00:00:00Z"), hour: 9, netSales: 100 },
    { storeId: "h", date: new Date("2026-11-11T00:00:00Z"), hour: 9, netSales: 80 },
  ] as never)
})

describe("loadElapsedCompare", () => {
  it("bounds every read by the account", async () => {
    const e = await loadElapsedCompare({ range: { start: WED, end: WED }, storeId: null, accountId: "acct_1", now })
    expect(e).toMatchObject({ state: "today", current: 100, prior: 80 })
    expect(vi.mocked(prisma.store.findMany).mock.calls[0][0]).toMatchObject({ where: { accountId: "acct_1" } })
    expect(vi.mocked(prisma.otterHourlySummary.findFirst).mock.calls[0][0]).toMatchObject({ where: { store: { accountId: "acct_1" } } })
    expect(vi.mocked(prisma.otterHourlySummary.findMany).mock.calls[0][0]).toMatchObject({ where: { store: { accountId: "acct_1" } } })
    expect(vi.mocked(prisma.jobRun.findFirst).mock.calls[0][0]).toMatchObject({
      where: { status: "SUCCESS", OR: [{ storeId: null }, { storeId: { in: ["h"] } }] },
    })
  })

  it("does not read at all for a range long finished", async () => {
    const old = new Date(2026, 10, 1)
    expect(await loadElapsedCompare({ range: { start: old, end: old }, storeId: null, accountId: "acct_1", now })).toBeNull()
    expect(prisma.store.findMany).not.toHaveBeenCalled()
  })
})
