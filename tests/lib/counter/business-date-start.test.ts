import { describe, expect, it } from "vitest"
import { businessDayStartInstant } from "@/lib/counter/business-date"

describe("businessDayStartInstant", () => {
  it("is LA midnight in daylight time", () => {
    expect(businessDayStartInstant(new Date("2026-10-27T00:00:00Z")).toISOString()).toBe("2026-10-27T07:00:00.000Z")
  })
  it("is LA midnight in standard time", () => {
    expect(businessDayStartInstant(new Date("2026-12-01T00:00:00Z")).toISOString()).toBe("2026-12-01T08:00:00.000Z")
  })
  it("handles the day clocks fall back", () => {
    expect(businessDayStartInstant(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-01T07:00:00.000Z")
    expect(businessDayStartInstant(new Date("2026-11-02T00:00:00Z")).toISOString()).toBe("2026-11-02T08:00:00.000Z")
  })
  it("handles the day clocks spring forward", () => {
    expect(businessDayStartInstant(new Date("2026-03-08T00:00:00Z")).toISOString()).toBe("2026-03-08T08:00:00.000Z")
    expect(businessDayStartInstant(new Date("2026-03-09T00:00:00Z")).toISOString()).toBe("2026-03-09T07:00:00.000Z")
  })
})
