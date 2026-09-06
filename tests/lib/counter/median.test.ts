import { describe, it, expect } from "vitest"
import { median } from "@/lib/counter/median"

describe("median", () => {
  it("averages the middle pair on even populations", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5) // prices.ts's old impl said 3
  })
  it("is the middle value on odd populations", () => expect(median([5, 1, 9])).toBe(5))
  it("is null, not 0, on empty", () => expect(median([])).toBeNull())
})
