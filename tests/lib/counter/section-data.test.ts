import { describe, it, expect } from "vitest"
import {
  ready, stale, loading, failed, empty, notComputed, hasData,
  type SectionData,
} from "@/lib/counter/section-data"

describe("SectionData", () => {
  it("ready carries its data", () => {
    expect(ready({ n: 1 })).toEqual({ status: "ready", data: { n: 1 } })
  })

  it("stale carries data AND when it was last good", () => {
    const at = new Date("2026-08-24T09:00:00Z")
    expect(stale({ n: 1 }, at)).toEqual({ status: "stale", data: { n: 1 }, lastGoodAt: at })
  })

  it("failed names the error and the action that retries it", () => {
    expect(failed("Otter sync timed out", "retrySync")).toEqual({
      status: "failed", error: "Otter sync timed out", retryAction: "retrySync",
    })
  })

  it("empty distinguishes a pre-open store from a filter that matched nothing", () => {
    expect(empty("pre_open").reason).toBe("pre_open")
    expect(empty("no_match").reason).toBe("no_match")
  })

  it("notComputed names what is owed", () => {
    expect(notComputed("clock-in/out leak ledger")).toEqual({
      status: "not_computed", owed: "clock-in/out leak ledger",
    })
  })

  it("hasData is true for exactly the two states that carry data", () => {
    expect(hasData(ready(1))).toBe(true)
    expect(hasData(stale(1, new Date("2026-08-24T09:00:00Z")))).toBe(true)
    expect(hasData(loading())).toBe(false)
    expect(hasData(failed("x", "y"))).toBe(false)
    expect(hasData(empty("no_match"))).toBe(false)
    expect(hasData(notComputed("x"))).toBe(false)
  })

  it("hasData narrows the type so .data is reachable without a cast", () => {
    const sd: SectionData<{ n: number }> = ready({ n: 7 })
    // The point of the guard: this line must compile with no assertion.
    expect(hasData(sd) ? sd.data.n : -1).toBe(7)
  })
})
