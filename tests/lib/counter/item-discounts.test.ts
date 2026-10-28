import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }))

import { prisma } from "@/lib/prisma"
import {
  allocateOrderDiscount,
  discountShare,
  getItemDiscounts,
  isDealRunning,
  netOfDiscount,
} from "@/lib/counter/item-discounts"

const SLIDER = "Signature Slider"

describe("allocateOrderDiscount", () => {
  it("gives a BOGO discount to the item it is a whole unit price of", () => {
    const out = allocateOrderDiscount(13.49, [
      { name: SLIDER, price: 13.49, quantity: 2 },
      { name: "Loaded Fries", price: 8.39, quantity: 1 },
    ])
    expect(out.get(SLIDER)).toBeCloseTo(13.49)
    expect(out.has("Loaded Fries")).toBe(false)
  })

  it("does not call it a BOGO when the order holds fewer units than the discount", () => {
    // $26.98 off is two free sliders, but only one was bought: spread it.
    const out = allocateOrderDiscount(26.98, [
      { name: SLIDER, price: 13.49, quantity: 1 },
      { name: "Fries", price: 13.49 * 3, quantity: 1 },
    ])
    expect(out.get(SLIDER)).toBeCloseTo(26.98 / 4)
    expect(out.get("Fries")).toBeCloseTo((26.98 * 3) / 4)
  })

  it("spreads anything else by value, and ignores a non-positive discount", () => {
    const out = allocateOrderDiscount(3, [
      { name: "A", price: 10, quantity: 1 },
      { name: "B", price: 5, quantity: 4 },
    ])
    expect(out.get("A")).toBeCloseTo(1)
    expect(out.get("B")).toBeCloseTo(2)
    expect(allocateOrderDiscount(0, [{ name: "A", price: 10, quantity: 1 }]).size).toBe(0)
  })

  it("treats a coupon equal to one unit's price as a coupon, not that item's deal", () => {
    const out = allocateOrderDiscount(3, [
      { name: "Side", price: 3, quantity: 1 },
      { name: "Main", price: 9, quantity: 1 },
    ])
    expect(out.get("Side")).toBeCloseTo(0.75)
    expect(out.get("Main")).toBeCloseTo(2.25)
  })
})

describe("share helpers", () => {
  it("nets revenue by the share and flags a deal over 10%", () => {
    const bogo = { gross: 26.98, discount: 13.49 }
    expect(discountShare(bogo)).toBeCloseTo(0.5)
    expect(netOfDiscount(100, bogo)).toBeCloseTo(50)
    expect(isDealRunning(bogo)).toBe(true)
    expect(isDealRunning({ gross: 100, discount: 4 })).toBe(false)
    expect(discountShare(undefined)).toBe(0)
    expect(discountShare({ gross: 0, discount: 5 })).toBe(0)
    expect(discountShare({ gross: 10, discount: 50 })).toBe(1)
  })
})

describe("getItemDiscounts", () => {
  it("returns nothing and queries nothing without stores", async () => {
    const out = await getItemDiscounts({
      accountId: "acc",
      storeIds: [],
      startDate: new Date(),
      endDate: new Date(),
    })
    expect(out.size).toBe(0)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("adds gross and allocated discounts per item and platform", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { name: SLIDER, platform: "ubereats", gross: 53.96 },
        { name: SLIDER, platform: "css-pos", gross: 20 },
        { name: "Fries", platform: "ubereats", gross: 8.39 },
      ] as never)
      .mockResolvedValueOnce([
        { orderId: "o1", platform: "ubereats", discount: 13.49, name: SLIDER, price: 13.49, quantity: 2 },
        { orderId: "o1", platform: "ubereats", discount: 13.49, name: "Fries", price: 8.39, quantity: 1 },
        { orderId: "o2", platform: "ubereats", discount: 13.49, name: SLIDER, price: 13.49, quantity: 2 },
      ] as never)

    const out = await getItemDiscounts({
      accountId: "acc",
      storeIds: ["s1"],
      startDate: new Date(),
      endDate: new Date(),
    })
    const slider = out.get(SLIDER)!
    expect(slider.gross).toBeCloseTo(73.96)
    expect(slider.discount).toBeCloseTo(26.98)
    expect(discountShare(slider.byPlatform.get("ubereats"))).toBeCloseTo(0.5)
    expect(discountShare(slider.byPlatform.get("css-pos"))).toBe(0)
    expect(out.get("Fries")!.discount).toBe(0)
  })

  it("splits the same figures by store, so one store's deal stays that store's", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([
        { name: SLIDER, platform: "ubereats", storeId: "holly", gross: 53.96 },
        { name: SLIDER, platform: "ubereats", storeId: "gln", gross: 53.96 },
      ] as never)
      .mockResolvedValueOnce([
        { orderId: "o1", platform: "ubereats", storeId: "holly", discount: 26.98, name: SLIDER, price: 13.49, quantity: 4 },
      ] as never)

    const out = await getItemDiscounts({
      accountId: "acc",
      storeIds: ["holly", "gln"],
      startDate: new Date(),
      endDate: new Date(),
    })
    const slider = out.get(SLIDER)!
    expect(discountShare(slider)).toBeCloseTo(0.25)
    expect(discountShare(slider.byStore!.get("holly"))).toBeCloseTo(0.5)
    expect(discountShare(slider.byStore!.get("gln"))).toBe(0)
  })
})
