import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { loadLaborCost } from "@/lib/counter/labor-cost"

function db(daily: unknown[], positions: unknown[]) {
  return {
    harriDailyLabor: { findMany: vi.fn(async (_a: unknown) => daily) },
    harriPositionDaily: { groupBy: vi.fn(async (_a: unknown) => positions) },
  }
}

describe("loadLaborCost", () => {
  it("filters both reads by accountId through the store relation", async () => {
    const d = db([], [])
    await loadLaborCost(
      {
        accountId: "acct-A",
        storeIds: ["s1"],
        startDate: new Date("2026-10-19T00:00:00Z"),
        endDate: new Date("2026-10-25T00:00:00Z"),
      },
      d as never,
    )
    const dailyWhere = (d.harriDailyLabor.findMany.mock.calls[0][0] as { where: { store: unknown } }).where
    const posWhere = (d.harriPositionDaily.groupBy.mock.calls[0][0] as { where: { store: unknown } }).where
    expect(dailyWhere.store).toEqual({ accountId: "acct-A" })
    expect(posWhere.store).toEqual({ accountId: "acct-A" })
  })

  it("applies the rule: daily when real, else positions, else missing", async () => {
    const d = db(
      [
        { storeId: "s1", date: new Date("2026-10-19T00:00:00Z"), actualCost: 1000 },
        { storeId: "s1", date: new Date("2026-10-20T00:00:00Z"), actualCost: 0 },
      ],
      [
        { storeId: "s1", date: new Date("2026-10-19T00:00:00Z"), _sum: { totalLabor: 900 } },
        { storeId: "s1", date: new Date("2026-10-20T00:00:00Z"), _sum: { totalLabor: 800 } },
      ],
    )
    const r = await loadLaborCost(
      {
        accountId: "acct-A",
        storeIds: ["s1"],
        startDate: new Date("2026-10-19T00:00:00Z"),
        endDate: new Date("2026-10-21T00:00:00Z"),
      },
      d as never,
    )
    expect(r.total).toBe(1800)
    expect(r.stores.s1.missingDays).toEqual(["2026-10-21"])
  })

  it("reads nothing for an empty store list", async () => {
    const d = db([], [])
    const r = await loadLaborCost(
      { accountId: "a", storeIds: [], startDate: new Date(), endDate: new Date() },
      d as never,
    )
    expect(r.total).toBe(0)
    expect(d.harriDailyLabor.findMany).not.toHaveBeenCalled()
  })
})
