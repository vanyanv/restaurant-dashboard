// getChannelMix — net-rate per platform + shift simulation.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    store: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getChannelMix } from "@/app/actions/forecasts/channel-mix-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Store 1" },
  ] as never)
})

interface Row {
  platform: string
  fpGross?: number
  fpFees?: number
  fpOrders?: number
  tpGross?: number
  tpFees?: number
  tpOrders?: number
}

function row(r: Row) {
  return {
    platform: r.platform,
    fpGrossSales: r.fpGross ?? 0,
    fpFees: r.fpFees ?? 0,
    fpOrderCount: r.fpOrders ?? 0,
    tpGrossSales: r.tpGross ?? 0,
    tpFees: r.tpFees ?? 0,
    tpOrderCount: r.tpOrders ?? 0,
  }
}

describe("getChannelMix", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getChannelMix({})).toBeNull()
  })

  it("guards cross-account storeId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "stranger",
      name: "Stranger",
      accountId: "acct-OTHER",
    } as never)
    expect(await getChannelMix({ storeId: "stranger" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns no_data when there are no daily summaries", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    expect(await getChannelMix({})).toEqual({ ok: false, error: "no_data" })
  })

  it("computes per-platform net rate and identifies the worst donor / best recipient", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    // FP css-pos: $10k gross, $0 fees → 100% net rate
    // doordash: $5k gross, $1.5k fees → 70% net rate
    // ubereats: $3k gross, $1.2k fees → 60% net rate (worst)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpGross: 10000, fpFees: 0, fpOrders: 200 }),
      row({ platform: "doordash", tpGross: 5000, tpFees: 1500, tpOrders: 100 }),
      row({ platform: "ubereats", tpGross: 3000, tpFees: 1200, tpOrders: 60 }),
    ] as never)

    const result = await getChannelMix({ shiftPct: 0.1 })
    if (!result || !result.ok) throw new Error("expected ok")
    const byPlat = Object.fromEntries(
      result.data.rows.map((r) => [r.platform, r]),
    )
    expect(byPlat["css-pos"].netRatePct).toBeCloseTo(1.0, 5)
    expect(byPlat["doordash"].netRatePct).toBeCloseTo(0.7, 5)
    expect(byPlat["ubereats"].netRatePct).toBeCloseTo(0.6, 5)
    expect(byPlat["css-pos"].meanTicket).toBeCloseTo(50, 5)

    // Sorted by gross desc
    expect(result.data.rows.map((r) => r.platform)).toEqual([
      "css-pos",
      "doordash",
      "ubereats",
    ])

    // Total: $18k gross, $2.7k fees, $15.3k net → 85% blended.
    expect(result.data.totalGross).toBeCloseTo(18000, 5)
    expect(result.data.totalFees).toBeCloseTo(2700, 5)
    expect(result.data.blendedNetRatePct).toBeCloseTo(15300 / 18000, 5)

    // Simulation: shift 10% of ubereats gross ($300) to css-pos.
    // Incremental net = $300 × (1.0 − 0.6) = $120
    expect(result.data.simulation).not.toBeNull()
    expect(result.data.simulation!.fromPlatform).toBe("ubereats")
    expect(result.data.simulation!.toPlatform).toBe("css-pos")
    expect(result.data.simulation!.shiftedGross).toBeCloseTo(300, 5)
    expect(result.data.simulation!.incrementalNet).toBeCloseTo(120, 5)
  })

  it("skips simulation when only one channel is present", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpGross: 5000, fpFees: 0, fpOrders: 100 }),
    ] as never)
    const result = await getChannelMix({})
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.rows).toHaveLength(1)
    expect(result.data.simulation).toBeNull()
  })

  it("aggregates the same platform across multiple days", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "doordash", tpGross: 3000, tpFees: 900, tpOrders: 60 }),
      row({ platform: "css-pos", fpGross: 500, fpFees: 0, fpOrders: 10 }),
    ] as never)
    const result = await getChannelMix({})
    if (!result || !result.ok) throw new Error("expected ok")
    const dd = result.data.rows.find((r) => r.platform === "doordash")!
    expect(dd.grossSales).toBeCloseTo(3000, 5)
    expect(dd.fees).toBeCloseTo(900, 5)
    expect(dd.orderCount).toBe(60)
  })
})
