import { describe, it, expect } from "vitest"
import { ticketOf, feeAmount, netOf } from "@/lib/counter/order-signs"

/*
 * The fixture is a REAL row, read out of the live database on 2026-08-26, not
 * an invented one. That matters: every fixture in this project that covered
 * these columns before used a positive discount, which is a shape the database
 * does not contain — 0 rows of 40,055 — and that is why `subtotal − discount`
 * survived review.
 */
const REAL = { subtotal: 74.94, discount: -37.47, commission: -9.37 }

describe("the signs OtterOrder actually stores", () => {
  it("adds the discount, because it is stored negative", () => {
    expect(ticketOf(REAL)).toBeCloseTo(37.47, 2)
  })

  it("does not subtract it — that inflates the ticket threefold", () => {
    expect(ticketOf(REAL)).not.toBeCloseTo(REAL.subtotal - REAL.discount, 2)
  })

  it("reports the marketplace's cut as a positive amount", () => {
    expect(feeAmount(REAL)).toBeCloseTo(9.37, 2)
  })

  it("reads DoorDash's own rate off the discounted ticket", () => {
    expect((feeAmount(REAL) / ticketOf(REAL)) * 100).toBeCloseTo(25, 1)
  })

  it("nets the ticket down, never up", () => {
    expect(netOf(REAL)).toBeCloseTo(28.1, 2)
    expect(netOf(REAL)).toBeLessThan(ticketOf(REAL))
  })

  it("calls an in-house order's zero commission no fee at all", () => {
    expect(feeAmount({ commission: 0 })).toBe(0)
  })

  it("refuses to invent a fee if the column's convention ever flips", () => {
    expect(feeAmount({ commission: 5 })).toBe(0)
  })

  /*
   * `netOf` is built from `feeAmount`, not from the raw column, and on every
   * one of the 25,648 commission rows in the database the two agree. So
   * `ticketOf(order) + order.commission` passed the whole suite — the shape the
   * guard exists for is the one shape no fixture had.
   *
   * A positive commission would mean the column's convention had flipped.
   * `feeAmount` answers "no fee" to that, and the net has to follow: adding the
   * raw column instead makes the net EXCEED the ticket, and `buildOrderKeep`
   * then draws a chain with no operation between the two and a bottom line
   * larger than the top.
   */
  it("never nets an order UP, even if the commission column's sign flips", () => {
    const flipped = { subtotal: 10, discount: 0, commission: 5 }
    expect(netOf(flipped)).toBe(10)
    expect(netOf(flipped)).toBe(ticketOf(flipped))
    expect(netOf(flipped)).not.toBe(15)
  })

  it("is the ticket less the FEE, which is what the page draws under it", () => {
    // The chain is `ticket − commission = net`. If `netOf` reached the same
    // answer by addition, that identity would be a coincidence of the sign.
    expect(netOf(REAL)).toBeCloseTo(ticketOf(REAL) - feeAmount(REAL), 2)
  })
})
