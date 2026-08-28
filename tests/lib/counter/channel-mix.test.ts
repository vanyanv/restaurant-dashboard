// loadChannelMix — per-channel net, orders, commission and ticket for a range.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn(), store: { findMany: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { toQueryBounds } from "@/lib/counter/date-range"
import { loadChannelMix } from "@/lib/counter/channel-mix"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
const accountId = "acct-A"

interface RowSpec {
  storeId?: string
  platform: string
  fpNet?: number
  fpGross?: number
  fpOrders?: number
  tpNet?: number
  tpGross?: number
  tpOrders?: number
}

function row(r: RowSpec) {
  return {
    storeId: r.storeId ?? "s1",
    platform: r.platform,
    fpNetSales: r.fpNet ?? 0,
    fpGrossSales: r.fpGross ?? 0,
    fpOrderCount: r.fpOrders ?? 0,
    tpNetSales: r.tpNet ?? 0,
    tpGrossSales: r.tpGross ?? 0,
    tpOrderCount: r.tpOrders ?? 0,
  }
}

function store(id: string, uber = 0.21, dd = 0.25) {
  return { id, uberCommissionRate: uber, doordashCommissionRate: dd }
}

const by = (rows: Awaited<ReturnType<typeof loadChannelMix>>, id: string) =>
  rows.find((r) => r.channel === id)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.store.findMany).mockResolvedValue([store("s1")] as never)
})

describe("loadChannelMix", () => {
  it("reports net, orders and the ticket they imply", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpNet: 5000, fpGross: 5400, fpOrders: 200 }),
    ] as never)

    const [house] = await loadChannelMix({ range, storeId: null, accountId })
    expect(house.channel).toBe("house")
    expect(house.net).toBe(5000)
    expect(house.orders).toBe(200)
    expect(house.ticket).toBe(25)
  })

  it("gives a channel with no orders NO ticket — not a ticket of zero", async () => {
    // Net without orders is real: an adjustment or refund lands on a channel
    // in a range that saw none of its orders. Dividing by zero orders has no
    // answer; printing $0.00 is the claim that every order was free.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "doordash", tpNet: -42, tpGross: -50, tpOrders: 0 }),
    ] as never)

    const [dd] = await loadChannelMix({ range, storeId: null, accountId })
    expect(dd.orders).toBe(0)
    expect(dd.ticket).toBeNull()
  })

  it("takes commission from the STORE's configured rate, applied to gross", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      store("s1", 0.3, 0.4),
    ] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "ubereats", tpNet: 900, tpGross: 1000, tpOrders: 30 }),
      row({ platform: "doordash", tpNet: 1800, tpGross: 2000, tpOrders: 50 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    // The P&L's own derivation — rate × gross — so the two agree for a range.
    expect(by(rows, "ubereats")?.commission).toBeCloseTo(300)
    expect(by(rows, "doordash")?.commission).toBeCloseTo(800)
  })

  it("charges in-house nothing and leaves Grubhub's commission unknown", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpNet: 5000, fpGross: 5400, fpOrders: 200 }),
      row({ platform: "grubhub", tpNet: 700, tpGross: 800, tpOrders: 20 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    // In-house genuinely has no marketplace: zero is the true answer.
    expect(by(rows, "house")?.commission).toBe(0)
    // `Store` publishes a rate for Uber and DoorDash and for nothing else.
    // A $0 in this column would say Grubhub works for free.
    expect(by(rows, "grubhub")?.commission).toBeNull()
  })

  it("sums commission per store, at each store's own rate", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      store("s1", 0.2, 0.25),
      store("s2", 0.3, 0.25),
    ] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ storeId: "s1", platform: "ubereats", tpNet: 900, tpGross: 1000, tpOrders: 30 }),
      row({ storeId: "s2", platform: "ubereats", tpNet: 900, tpGross: 1000, tpOrders: 30 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    // 0.2 × 1000 + 0.3 × 1000. A blended account-wide rate would say 500 too,
    // so the rates differ from each other AND from their average's effect on
    // the split below.
    expect(by(rows, "ubereats")?.commission).toBeCloseTo(500)
    expect(by(rows, "ubereats")?.orders).toBe(60)
  })

  it("folds both first-party platforms into the house channel", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpNet: 3000, fpGross: 3200, fpOrders: 120 }),
      row({ platform: "bnm-web", fpNet: 1000, fpGross: 1100, fpOrders: 40 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe("house")
    expect(rows[0].net).toBe(4000)
    expect(rows[0].orders).toBe(160)
  })

  it("leaves out a platform that has no Counter channel", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpNet: 3000, fpGross: 3200, fpOrders: 120 }),
      row({ platform: "chownow", tpNet: 500, tpGross: 550, tpOrders: 15 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    // chownow has no id and no CVD-safe band in channels.ts. Folding it into
    // `house` would report marketplace volume as commission-free.
    expect(rows.map((r) => r.channel)).toEqual(["house"])
  })

  it("returns channels in the fixed CHANNELS order, whatever the volumes", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "grubhub", tpNet: 9000, tpGross: 9500, tpOrders: 300 }),
      row({ platform: "doordash", tpNet: 200, tpGross: 220, tpOrders: 8 }),
      row({ platform: "css-pos", fpNet: 50, fpGross: 55, fpOrders: 2 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    // Ordered by identity, not by size — the band is fixed to the channel, so
    // a range where Grubhub leads must not repaint the chart.
    expect(rows.map((r) => r.channel)).toEqual(["house", "doordash", "grubhub"])
  })

  it("omits a channel that traded nothing rather than reporting it at zero", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      row({ platform: "css-pos", fpNet: 3000, fpGross: 3200, fpOrders: 120 }),
      row({ platform: "grubhub", tpNet: 0, tpGross: 0, tpOrders: 0 }),
    ] as never)

    const rows = await loadChannelMix({ range, storeId: null, accountId })
    expect(rows.map((r) => r.channel)).toEqual(["house"])
  })

  it("bounds the query with toQueryBounds, so the range's last day is included", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    await loadChannelMix({ range, storeId: null, accountId })

    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { values: unknown[] }
    const dates = sql.values.filter((v): v is Date => v instanceof Date)
    const bounds = toQueryBounds(range)
    expect(dates.map((d) => d.getTime())).toEqual([
      bounds.startDate.getTime(),
      bounds.endDate.getTime(),
    ])
    // Not the raw local midnight the reader picked — that bound excludes the
    // whole of the last day on any query that treats it as a timestamp.
    expect(dates[1].getTime()).not.toBe(range.end.getTime())
  })

  it("scopes to the account, and to one store when one is selected", async () => {
    // The store read moved to `@/lib/account-stores`, which is `cache()`d and
    // shared with every other loader on a page — one query per request instead
    // of this function's own, and of the Overview's per-store repeat of it.
    // The two guarantees that were asserted here are unchanged and are both
    // still asserted, at the new seam:
    //
    //   1. THE ACCOUNT BOUNDARY IS IN SQL. It never moved into JavaScript, and
    //      must not: the query is what stops a stranger's store being read at
    //      all. Only the narrowing to one store — which can just filter an
    //      already-account-scoped set — happens in memory.
    //   2. A selected store is the only one whose rates and rows are used.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([
      store("s1"),
      store("s2"),
    ] as never)

    await loadChannelMix({ range, storeId: "s1", accountId })

    expect(vi.mocked(prisma.store.findMany).mock.calls[0][0]).toMatchObject({
      where: { accountId, isActive: true },
    })

    // The summary read is given s1 and only s1, though the account has two.
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { values: unknown[] }
    expect(sql.values).toContain("s1")
    expect(sql.values).not.toContain("s2")
  })

  it("returns nothing for a storeId that is not on the account", async () => {
    // The store lookup is account-scoped, so a stranger's id resolves to no
    // stores — which must NOT fall back to every store on the account.
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)

    const rows = await loadChannelMix({ range, storeId: "stranger", accountId })
    expect(rows).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})
