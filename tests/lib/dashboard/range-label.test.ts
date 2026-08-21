import { describe, it, expect, vi, afterEach } from "vitest"
import { rangeDateLabel } from "@/lib/dashboard/range-label"

afterEach(() => vi.useRealTimers())

/** Pin the clock to a known instant, expressed in UTC. */
function at(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

describe("rangeDateLabel", () => {
  it("names today", () => {
    at("2026-08-20T18:00:00Z") // 11:00 PDT
    expect(rangeDateLabel({ kind: "days", days: 1 })).toBe("Aug 20")
  })

  it("names yesterday", () => {
    at("2026-08-20T18:00:00Z")
    expect(rangeDateLabel({ kind: "days", days: -1 })).toBe("Aug 19")
  })

  it("spans a trailing window inclusively", () => {
    at("2026-08-20T18:00:00Z")
    // Seven days ending today includes today, so it starts on the 14th.
    expect(rangeDateLabel({ kind: "days", days: 7 })).toBe("Aug 14 – Aug 20")
  })

  it("reads the day from the store's clock, not the server's", () => {
    // 05:00Z on the 20th is still 22:00 PDT on the 19th.
    at("2026-08-20T05:00:00Z")
    expect(rangeDateLabel({ kind: "days", days: 1 })).toBe("Aug 19")
  })

  it("collapses a single-day custom range to one date", () => {
    expect(
      rangeDateLabel({ kind: "custom", startDate: "2026-08-19", endDate: "2026-08-19" })
    ).toBe("Aug 19")
  })

  it("spans a custom range", () => {
    expect(
      rangeDateLabel({ kind: "custom", startDate: "2026-08-01", endDate: "2026-08-19" })
    ).toBe("Aug 1 – Aug 19")
  })

  it("crosses a month boundary", () => {
    expect(
      rangeDateLabel({ kind: "custom", startDate: "2026-07-28", endDate: "2026-08-03" })
    ).toBe("Jul 28 – Aug 3")
  })
})
