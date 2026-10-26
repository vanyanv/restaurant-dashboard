import { describe, expect, it } from "vitest"
import { cleanTracking, guessCarrier, moneyLabel, orderState } from "@/lib/shop/status"

const now = new Date("2026-10-26T20:00:00.000Z")
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

describe("orderState", () => {
  it("a fresh paid ship order is waiting on you, next step ship", () => {
    const s = orderState({ status: "paid", fulfilment: "ship", createdAt: hoursAgo(2) }, now)
    expect(s).toMatchObject({ glyph: "open", label: "To ship", next: "ship", canRefund: true, open: true })
  })

  it("a paid ship order is late after 24 hours, and says how long", () => {
    expect(orderState({ status: "paid", fulfilment: "ship", createdAt: hoursAgo(30) }, now)).toMatchObject({
      glyph: "late",
      label: "To ship · waiting 30 h",
      next: "ship",
    })
    expect(orderState({ status: "paid", fulfilment: "ship", createdAt: hoursAgo(80) }, now).label).toBe("To ship · waiting 3 days")
  })

  it("uses paidAt over createdAt when the detail has it", () => {
    const s = orderState({ status: "paid", fulfilment: "ship", createdAt: hoursAgo(30), paidAt: hoursAgo(1) }, now)
    expect(s.glyph).toBe("open")
  })

  it("a paid pickup order is to bag, never late", () => {
    expect(orderState({ status: "paid", fulfilment: "pickup", createdAt: hoursAgo(100) }, now)).toMatchObject({
      glyph: "open",
      label: "To bag",
      next: "ready",
    })
  })

  it("a bagged order waits for pickup", () => {
    expect(orderState({ status: "ready_for_pickup", fulfilment: "pickup", createdAt: hoursAgo(5) }, now)).toMatchObject({
      next: "picked_up",
      open: true,
      canRefund: true,
    })
  })

  it("done, refunded, cancelled and unpaid have no next step", () => {
    const at = hoursAgo(1)
    expect(orderState({ status: "fulfilled", fulfilment: "ship", createdAt: at }, now)).toMatchObject({ glyph: "ok", next: null, canRefund: true })
    expect(orderState({ status: "picked_up", fulfilment: "pickup", createdAt: at }, now)).toMatchObject({ glyph: "ok", next: null, canRefund: true })
    expect(orderState({ status: "refunded", fulfilment: "ship", createdAt: at }, now)).toMatchObject({ glyph: "miss", canRefund: false })
    expect(orderState({ status: "cancelled", fulfilment: "ship", createdAt: at }, now)).toMatchObject({ glyph: "up", canRefund: false })
    expect(orderState({ status: "pending", fulfilment: "ship", createdAt: at }, now)).toMatchObject({ label: "Not paid", canRefund: false })
  })
})

describe("tracking numbers", () => {
  it("guesses the carrier from the number's shape", () => {
    expect(guessCarrier("1Z999AA10123456784")).toBe("UPS")
    expect(guessCarrier("9400 1000 0000 0000 0000 00")).toBe("USPS")
    expect(guessCarrier("EC123456789US")).toBe("USPS")
    expect(guessCarrier("123456789012")).toBe("FedEx")
    expect(guessCarrier("hello")).toBeNull()
  })

  it("drops the 420+ZIP routing prefix a scanned USPS label carries", () => {
    expect(cleanTracking("42090028 9400100000000000000000")).toBe("9400100000000000000000")
    expect(cleanTracking("420900281234 9400100000000000000000")).toBe("9400100000000000000000")
    expect(cleanTracking(" 1z999aa10123456784 ")).toBe("1Z999AA10123456784")
  })
})

describe("moneyLabel", () => {
  it("formats cents", () => {
    expect(moneyLabel(3200)).toBe("$32.00")
    expect(moneyLabel(123456)).toBe("$1,234.56")
    expect(moneyLabel(-5)).toBe("-$0.05")
  })
})
