import { describe, it, expect } from "vitest"
import {
  channelKindOf,
  foldChannelRows,
  foldChannelRowsByStore,
  splitChannelKey,
  type FoldedChannel,
} from "@/lib/dashboard/channel-fold"
import type { StoreSummaryRow } from "@/types/analytics"

function row(key: string, over: Partial<StoreSummaryRow> = {}): StoreSummaryRow {
  return {
    storeId: key,
    storeName: key,
    grossSales: 0,
    fulfilledOrders: 0,
    discounts: 0,
    loyalty: 0,
    refundsAdjustments: 0,
    netSales: 0,
    serviceCharges: 0,
    commissionFees: 0,
    taxCollected: 0,
    taxRemitted: 0,
    tips: 0,
    paidIn: 0,
    paidOut: 0,
    theoreticalDeposit: 0,
    cashDrawerRecon: null,
    expectedDeposit: 0,
    ...over,
  }
}

describe("channelKindOf", () => {
  it("treats both first-party platforms as in-house", () => {
    expect(channelKindOf("css-pos|||CARD")).toBe("in-house")
    expect(channelKindOf("css-pos|||CASH")).toBe("in-house")
    expect(channelKindOf("bnm-web|||CARD")).toBe("in-house")
  })

  it("keeps each delivery platform distinct", () => {
    expect(channelKindOf("doordash|||")).toBe("doordash")
    expect(channelKindOf("ubereats|||")).toBe("ubereats")
    expect(channelKindOf("grubhub|||")).toBe("grubhub")
  })

  it("buckets anything unrecognised rather than dropping it", () => {
    expect(channelKindOf("caviar|||")).toBe("other")
    expect(channelKindOf("something-new")).toBe("other")
  })
})

describe("foldChannelRows", () => {
  it("collapses the tender split into one in-house line", () => {
    const folded = foldChannelRows([
      row("css-pos|||CARD", { fulfilledOrders: 60, grossSales: 1148, netSales: 1140 }),
      row("css-pos|||CASH", { fulfilledOrders: 20, grossSales: 447, netSales: 447 }),
      row("bnm-web|||CARD", { fulfilledOrders: 3, grossSales: 64, netSales: 64 }),
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0].label).toBe("In-house")
    expect(folded[0].orders).toBe(83)
    expect(folded[0].gross).toBe(1659)
    expect(folded[0].net).toBe(1651)
  })

  it("keeps delivery platforms separate and sums their fees", () => {
    const folded = foldChannelRows([
      row("doordash|||", { fulfilledOrders: 84, grossSales: 2465, commissionFees: -807, expectedDeposit: 1658 }),
      row("ubereats|||", { fulfilledOrders: 144, grossSales: 3893, commissionFees: -255, expectedDeposit: 2727 }),
    ])
    expect(folded.map((f) => f.label)).toEqual(["DoorDash", "UberEats"])
    expect(folded.find((f) => f.kind === "doordash")!.fees).toBe(-807)
  })

  it("orders in-house first, then delivery, then other", () => {
    const folded = foldChannelRows([
      row("caviar|||", { grossSales: 10 }),
      row("ubereats|||", { grossSales: 10 }),
      row("css-pos|||CARD", { grossSales: 10 }),
      row("doordash|||", { grossSales: 10 }),
      row("grubhub|||", { grossSales: 10 }),
    ])
    expect(folded.map((f) => f.kind)).toEqual([
      "in-house",
      "doordash",
      "grubhub",
      "ubereats",
      "other",
    ])
  })

  it("foots to the same totals as the rows it folded", () => {
    const rows = [
      row("css-pos|||CARD", { fulfilledOrders: 60, grossSales: 1148, discounts: -79, netSales: 1140, commissionFees: -37, expectedDeposit: 1119 }),
      row("css-pos|||CASH", { fulfilledOrders: 20, grossSales: 447, netSales: 447, expectedDeposit: 447 }),
      row("doordash|||", { fulfilledOrders: 84, grossSales: 2465, discounts: -807, netSales: 1657, commissionFees: -174, expectedDeposit: 1483 }),
    ]
    const folded = foldChannelRows(rows)
    const sum = (pick: (f: FoldedChannel) => number) =>
      folded.reduce((a, f) => a + pick(f), 0)
    expect(sum((f) => f.orders)).toBe(164)
    expect(sum((f) => f.gross)).toBe(4060)
    expect(sum((f) => f.discounts)).toBe(-886)
    expect(sum((f) => f.net)).toBe(3244)
    expect(sum((f) => f.fees)).toBe(-211)
    expect(sum((f) => f.payout)).toBe(3049)
  })

  it("returns nothing for no rows", () => {
    expect(foldChannelRows([])).toEqual([])
  })
})

describe("splitChannelKey", () => {
  it("reads the platform from an account-wide key", () => {
    expect(splitChannelKey("doordash|||")).toEqual({
      storeId: null,
      platform: "doordash",
    })
  })

  it("reads store and platform from a per-store key", () => {
    expect(splitChannelKey("store-1|||css-pos|||CARD")).toEqual({
      storeId: "store-1",
      platform: "css-pos",
    })
  })
})

describe("foldChannelRowsByStore", () => {
  it("keeps each store's channels to that store", () => {
    const byStore = foldChannelRowsByStore([
      row("s1|||doordash|||", { fulfilledOrders: 10, grossSales: 100 }),
      row("s1|||css-pos|||CARD", { fulfilledOrders: 5, grossSales: 50 }),
      row("s2|||doordash|||", { fulfilledOrders: 3, grossSales: 30 }),
    ])
    expect([...byStore.keys()].sort()).toEqual(["s1", "s2"])
    expect(byStore.get("s1")!.map((c) => c.kind)).toEqual(["in-house", "doordash"])
    expect(byStore.get("s2")!).toHaveLength(1)
    expect(byStore.get("s2")![0].gross).toBe(30)
  })

  it("folds a store's tender split the same way", () => {
    const byStore = foldChannelRowsByStore([
      row("s1|||css-pos|||CARD", { grossSales: 60 }),
      row("s1|||css-pos|||CASH", { grossSales: 40 }),
    ])
    expect(byStore.get("s1")!).toHaveLength(1)
    expect(byStore.get("s1")![0].gross).toBe(100)
  })

  it("drops account-wide rows rather than pooling them under a store", () => {
    // A two-part key has no store segment; attributing it to one location is
    // exactly the bug this split exists to prevent.
    expect(foldChannelRowsByStore([row("doordash|||", { grossSales: 99 })]).size).toBe(0)
  })
})
