// getLaunchTrajectory — detect newly-launched menu items and project 90d.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getLaunchTrajectory } from "@/app/actions/forecasts/launch-trajectory-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  // Default aggregate-mode store list; individual tests override for scoped cases.
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "store-A", name: "Store A" },
  ] as never)
})

interface Row {
  storeId: string
  date: string
  category: string
  itemName: string
  fp?: number
  tp?: number
  fpRev?: number
  tpRev?: number
}

function row(r: Row) {
  return {
    storeId: r.storeId,
    date: new Date(`${r.date}T00:00:00Z`),
    category: r.category,
    itemName: r.itemName,
    fpQuantitySold: r.fp ?? 0,
    tpQuantitySold: r.tp ?? 0,
    fpTotalSales: r.fpRev ?? (r.fp ?? 0) * 10,
    tpTotalSales: r.tpRev ?? (r.tp ?? 0) * 10,
  }
}

describe("getLaunchTrajectory", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getLaunchTrajectory({})).toBeNull()
  })

  it("guards cross-account storeId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "stranger",
      name: "Stranger",
      accountId: "acct-OTHER",
    } as never)
    expect(await getLaunchTrajectory({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("classifies an item as newly-launched and projects 90d qty", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // First sale 2026-04-25, sustained ~5/day for 14 days into 2026-05-08.
    const fixtures: Row[] = []
    for (let i = 0; i < 14; i++) {
      const d = new Date("2026-04-25T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      fixtures.push({
        storeId: "store-A",
        date: d.toISOString().slice(0, 10),
        category: "Burgers",
        itemName: "Smash Stack",
        fp: 5,
        fpRev: 60,
      })
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )

    const result = await getLaunchTrajectory({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.launches).toHaveLength(1)
    const lt = result.data.launches[0]
    expect(lt.itemName).toBe("Smash Stack")
    expect(lt.daysSinceLaunch).toBe(14)
    expect(lt.totalQty).toBeCloseTo(70, 5) // 14 days × 5
    expect(lt.projection).not.toBeNull()
    expect(lt.projection!.meanDailyQtyTrailing7).toBeCloseTo(5, 5)
    expect(lt.projection!.projectedQty90d).toBeCloseTo(450, 5)
    // Constant 5/day → std=0 → CI collapses to point estimate.
    expect(lt.projection!.stdDailyQtyTrailing7).toBeCloseTo(0, 5)
    expect(lt.projection!.projectedQtyCI80Low).toBeCloseTo(450, 5)
    expect(lt.projection!.projectedQtyCI80High).toBeCloseTo(450, 5)
  })

  it("excludes items whose first sale predates the window (not a launch)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // Item sold 5 months ago, still selling — not a launch.
    const fixtures: Row[] = []
    for (let i = 0; i < 30; i++) {
      const d = new Date("2025-12-01T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i * 5)
      fixtures.push({
        storeId: "store-A",
        date: d.toISOString().slice(0, 10),
        category: "Burgers",
        itemName: "Classic",
        fp: 10,
      })
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )
    const result = await getLaunchTrajectory({
      asOf: new Date("2026-05-08T00:00:00Z"),
      recentDays: 30,
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.launches).toHaveLength(0)
  })

  it("yields trajectory but no projection when launch is < 7 days old", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    const fixtures: Row[] = []
    for (let i = 0; i < 4; i++) {
      const d = new Date("2026-05-05T00:00:00Z")
      d.setUTCDate(d.getUTCDate() + i)
      fixtures.push({
        storeId: "store-A",
        date: d.toISOString().slice(0, 10),
        category: "Drinks",
        itemName: "Mango Lassi",
        fp: 3,
      })
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue(
      fixtures.map(row) as never,
    )
    const result = await getLaunchTrajectory({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.launches).toHaveLength(1)
    expect(result.data.launches[0].projection).toBeNull()
    expect(result.data.launches[0].daysSinceLaunch).toBe(4)
  })

  it("ranks launches by total revenue descending", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    const mkSeries = (
      itemName: string,
      qty: number,
      unitRev: number,
    ): Row[] => {
      const out: Row[] = []
      for (let i = 0; i < 10; i++) {
        const d = new Date("2026-04-28T00:00:00Z")
        d.setUTCDate(d.getUTCDate() + i)
        out.push({
          storeId: "store-A",
          date: d.toISOString().slice(0, 10),
          category: "Mains",
          itemName,
          fp: qty,
          fpRev: qty * unitRev,
        })
      }
      return out
    }
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      ...mkSeries("Big Money Item", 8, 18),
      ...mkSeries("Niche Item", 1, 5),
    ].map(row) as never)
    const result = await getLaunchTrajectory({
      asOf: new Date("2026-05-08T00:00:00Z"),
    })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.launches.map((l) => l.itemName)).toEqual([
      "Big Money Item",
      "Niche Item",
    ])
  })
})
