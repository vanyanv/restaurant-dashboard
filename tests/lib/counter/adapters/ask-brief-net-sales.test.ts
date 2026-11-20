// netSalesOn reads yesterday and the same weekday a week before in ONE query
// (`date in`) and must return exactly what two single-day reads returned.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { otterDailySummary: { findMany: vi.fn() } } }))
vi.mock("@/lib/counter/adapters/prices", () => ({ loadPrices: vi.fn() }))
vi.mock("@/lib/counter/adapters/shell-status", () => ({ getShellStatus: vi.fn() }))
vi.mock("@/lib/cache/cached", () => ({ cached: vi.fn(), stableKey: () => "" }))

import { prisma } from "@/lib/prisma"
import { netSalesOn } from "@/lib/counter/adapters/ask-brief"

const asMock = (f: unknown) => f as ReturnType<typeof vi.fn>
const rowOf = (day: string, gross: number) => ({
  date: new Date(`${day}T00:00:00.000Z`),
  platform: "UBEREATS",
  fpGrossSales: 0,
  tpGrossSales: gross,
  fpDiscounts: 0,
  tpDiscounts: -5,
  fpServiceCharges: 0,
  tpServiceCharges: 1,
  tpRefundsAdjustments: 0,
  fpTaxCollected: 0,
  tpTaxCollected: 2,
})

beforeEach(() => vi.clearAllMocks())

describe("netSalesOn", () => {
  it("splits one read by day: net per day, null for a day with no rows", async () => {
    asMock(prisma.otterDailySummary.findMany).mockResolvedValue([
      rowOf("2026-11-18", 100),
      rowOf("2026-11-18", 50.5),
      rowOf("2026-11-11", 80),
    ])
    const [yesterday, prior] = await netSalesOn("acct-A", ["s1"], [new Date(2026, 10, 18), new Date(2026, 10, 11)])
    expect(yesterday).toBe(100 - 5 + 1 + (50.5 - 5 + 1))
    expect(prior).toBe(80 - 5 + 1)
    expect(asMock(prisma.otterDailySummary.findMany)).toHaveBeenCalledTimes(1)
    const where = asMock(prisma.otterDailySummary.findMany).mock.calls[0][0].where
    expect(where.store).toEqual({ accountId: "acct-A" })
    expect(where.date.in.map((x: Date) => x.toISOString().slice(0, 10))).toEqual(["2026-11-18", "2026-11-11"])

    asMock(prisma.otterDailySummary.findMany).mockResolvedValue([rowOf("2026-11-18", 100)])
    const [a, b] = await netSalesOn("acct-A", ["s1"], [new Date(2026, 10, 18), new Date(2026, 10, 11)])
    expect(a).toBe(96)
    expect(b).toBeNull()
  })
})
