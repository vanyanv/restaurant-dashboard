// Own-website orders: Otter's ORDER rows call them `d2c-eater-website`, its
// DAILY SUMMARY calls the same orders `bnm-web`. Both are first-party and owe
// no commission. One list decides it; these hold every reader to it.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { FIRST_PARTY_PLATFORMS, isFirstPartyPlatform } from "@/lib/first-party-platforms"
import {
  COMMISSION_FREE_PLATFORMS,
  salesSlices,
  totalCommission,
  type OrderFeeGroup,
  type StoreCommissionRates,
} from "@/lib/counter/commission-core"
import { CHANNEL_FOR_PLATFORM, HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"
import { PLATFORM_LABEL } from "@/lib/counter/channels"
import { rowSales } from "@/lib/pnl"

describe("first-party platforms — one list", () => {
  it("names the POS and both spellings of the own website", () => {
    expect([...FIRST_PARTY_PLATFORMS].sort()).toEqual(["bnm-web", "css-pos", "d2c-eater-website"])
    expect(isFirstPartyPlatform("d2c-eater-website")).toBe(true)
    expect(isFirstPartyPlatform("doordash")).toBe(false)
    expect(isFirstPartyPlatform(null)).toBe(false)
  })

  it("is the commission-free set and the house channel", () => {
    expect([...COMMISSION_FREE_PLATFORMS].sort()).toEqual([...FIRST_PARTY_PLATFORMS].sort())
    expect([...HOUSE_PLATFORMS].sort()).toEqual([...FIRST_PARTY_PLATFORMS].sort())
    expect(CHANNEL_FOR_PLATFORM["d2c-eater-website"]).toBe("house")
    expect(CHANNEL_FOR_PLATFORM.doordash).toBe("doordash")
    expect(PLATFORM_LABEL["d2c-eater-website"]).toBe(PLATFORM_LABEL["bnm-web"])
  })

  it("charges no commission on an own-website order, and does not call it unknown", () => {
    const rates = new Map<string, StoreCommissionRates>([
      ["s1", { uberCommissionRate: 0.27, doordashCommissionRate: 0.25 }],
    ])
    const groups: OrderFeeGroup[] = [
      { storeId: "s1", day: "2026-11-01", platform: "d2c-eater-website", mode: "pickup", recorded: false, orders: 12, fee: 0, ticket: 300 },
      { storeId: "s1", day: "2026-11-01", platform: "doordash", mode: "delivery", recorded: false, orders: 4, fee: 0, ticket: 100 },
    ]
    const t = totalCommission(groups, rates)
    expect(t.unknownOrders).toBe(0)
    expect(t.orders).toBe(4)
    expect(t.amount).toBeCloseTo(25, 6)
  })

  it("keeps own-website summary rows out of the marketplace slices", () => {
    const slices = salesSlices([
      { storeId: "s1", date: "2026-11-01", platform: "d2c-eater-website", orders: 12, net: 300 },
      { storeId: "s1", date: "2026-11-01", platform: "ubereats", orders: 3, net: 90 },
    ])
    expect(slices.map((s) => s.platform)).toEqual(["ubereats"])
  })

  it("reads an own-website summary row's sales from the first-party columns", () => {
    const row = {
      platform: "d2c-eater-website",
      paymentMethod: "CARD",
      fpGrossSales: 300,
      tpGrossSales: 999,
      fpTaxCollected: null,
      tpTaxCollected: null,
      fpDiscounts: null,
      tpDiscounts: null,
      fpServiceCharges: null,
      tpServiceCharges: null,
    }
    expect(rowSales(row).gross).toBe(300)
  })
})
