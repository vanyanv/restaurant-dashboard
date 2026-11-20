// One shared read of HarriPositionDaily; the hours per (store, day) summed from
// it must equal what `groupBy(["storeId","date"])` + `_sum.actualSeconds` gave.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { harriPositionDaily: { findMany: vi.fn() } } }))

import { prisma } from "@/lib/prisma"
import { actualSecondsByStoreDay, loadHarriPositionRows } from "@/lib/harri-position-rows"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const row = (storeId: string, day: string, pos: string, actualSeconds: number | null) => ({
  storeId,
  date: d(day),
  positionCode: pos,
  positionName: pos,
  payType: "HOURLY",
  totalLabor: 10,
  actualSeconds,
  overtimeAmount: null,
})

beforeEach(() => vi.clearAllMocks())

describe("actualSecondsByStoreDay", () => {
  it("sums positions per store-day like the groupBy did, and keeps an all-null day null", () => {
    const out = actualSecondsByStoreDay([
      row("s1", "2026-11-02", "cook", 3600),
      row("s1", "2026-11-02", "cashier", 1800),
      row("s1", "2026-11-03", "cook", null),
      row("s2", "2026-11-02", "cook", 7200),
    ])
    const by = Object.fromEntries(out.map((r) => [`${r.storeId}|${r.date.toISOString().slice(0, 10)}`, r._sum.actualSeconds]))
    expect(by).toEqual({ "s1|2026-11-02": 5400, "s1|2026-11-03": null, "s2|2026-11-02": 7200 })
  })
})

describe("loadHarriPositionRows", () => {
  it("reads through the account's stores, for the span asked", async () => {
    vi.mocked(prisma.harriPositionDaily.findMany).mockResolvedValue([] as never)
    await loadHarriPositionRows({ accountId: "acct-A", storeIds: ["s1"], startDate: d("2026-11-01"), endDate: d("2026-11-07") })
    const args = vi.mocked(prisma.harriPositionDaily.findMany).mock.calls[0][0]!
    expect(args.where).toMatchObject({
      storeId: { in: ["s1"] },
      store: { accountId: "acct-A" },
      date: { gte: d("2026-11-01"), lte: d("2026-11-07") },
    })
  })
})
