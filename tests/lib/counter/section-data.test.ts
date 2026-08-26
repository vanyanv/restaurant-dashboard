import { describe, it, expect } from "vitest"
import {
  ready, stale, loading, failed, empty, notComputed, hasData,
  dataOf, isMissing, mapReady, mapReadyTo,
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

  it("isMissing is true for `empty` ALONE — a failed load is not a missing record", () => {
    // The distinction a detail page 404s on. If this ever returned true for
    // `failed`, /dashboard/orders/[id] would answer "no such order" during a
    // database outage — a lie told to the one reader who needs the truth.
    expect(isMissing(empty("no_match"))).toBe(true)
    expect(isMissing(empty("pre_open"))).toBe(true)
    expect(isMissing(failed("db down", "retryOrder"))).toBe(false)
    expect(isMissing(loading())).toBe(false)
    expect(isMissing(notComputed("x"))).toBe(false)
    expect(isMissing(ready(1))).toBe(false)
    expect(isMissing(stale(1, new Date("2026-08-24T09:00:00Z")))).toBe(false)
  })

  it("hasData narrows the type so .data is reachable without a cast", () => {
    const sd: SectionData<{ n: number }> = ready({ n: 7 })
    // The point of the guard: this line must compile with no assertion.
    expect(hasData(sd) ? sd.data.n : -1).toBe(7)
  })

  it("dataOf reads the two states that carry data and nothing else", () => {
    expect(dataOf(ready({ n: 1 }))).toEqual({ n: 1 })
    expect(dataOf(stale({ n: 1 }, new Date("2026-08-24T09:00:00Z")))).toEqual({ n: 1 })
    const blank: SectionData<{ n: number }>[] = [
      loading(), failed("x", "y"), empty("pre_open"), notComputed("x"),
    ]
    for (const sd of blank) expect(dataOf(sd)).toBeNull()
  })

  it("mapReady runs the mapper on data and carries every other status through UNCHANGED", () => {
    // The whole point: one query answers many sections, so a failure that
    // reached one of them must reach all of them with its own words intact.
    const at = new Date("2026-08-24T09:00:00Z")
    const triple = (sd: SectionData<number>) => mapReady(sd, (n) => n * 3)
    expect(triple(ready(2))).toEqual({ status: "ready", data: 6 })
    expect(triple(stale(2, at))).toEqual({ status: "stale", data: 6, lastGoodAt: at })
    expect(triple(failed("Otter timed out", "retrySales"))).toEqual({
      status: "failed", error: "Otter timed out", retryAction: "retrySales",
    })
    expect(triple(empty("pre_open"))).toEqual({ status: "empty", reason: "pre_open" })
    expect(triple(notComputed("a provenance model"))).toEqual({
      status: "not_computed", owed: "a provenance model",
    })
    expect(triple(loading())).toEqual({ status: "loading" })
  })

  it("mapReady never calls the mapper on a status that carries no data", () => {
    let calls = 0
    const blank: SectionData<number>[] = [
      loading(),
      failed("x", "y"),
      empty("no_match"),
      notComputed("x"),
    ]
    for (const sd of blank) {
      mapReady(sd, (n) => {
        calls += 1
        return n
      })
    }
    expect(calls).toBe(0)
  })

  it("mapReadyTo lets the mapper answer 'loaded, and there is nothing here'", () => {
    expect(mapReadyTo(ready(0), (n) => (n === 0 ? empty<number>("no_match") : ready(n)))).toEqual({
      status: "empty", reason: "no_match",
    })
  })

  it("mapReadyTo keeps a stale reading stale, and drops the staleness when the mapper empties it", () => {
    const at = new Date("2026-08-24T09:00:00Z")
    expect(mapReadyTo(stale(2, at), (n) => ready(n * 3))).toEqual({
      status: "stale", data: 6, lastGoodAt: at,
    })
    expect(mapReadyTo(stale(0, at), () => empty<number>("pre_open"))).toEqual({
      status: "empty", reason: "pre_open",
    })
  })
})
