import { describe, it, expect } from "vitest"
import { blendedMargin } from "@/lib/counter/blended-margin"

describe("blendedMargin", () => {
  it("is 100 - (cost/revenue)*100 as a margin percent", () => {
    expect(blendedMargin(30, 100)).toBe(70)
  })
  it("is null, not 0, with no revenue", () => expect(blendedMargin(30, 0)).toBeNull())
  it("is null with negative revenue", () => expect(blendedMargin(30, -5)).toBeNull())
})
