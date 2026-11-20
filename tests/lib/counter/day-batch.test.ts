import { describe, expect, it, vi } from "vitest"

// A render's `cache`: one value for the whole test file, like one request.
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>()
  return {
    ...actual,
    cache: <T extends (...a: never[]) => unknown>(fn: T) => {
      let v: unknown
      let set = false
      return ((...a: never[]) => {
        if (!set) {
          v = fn(...a)
          set = true
        }
        return v
      }) as T
    },
  }
})

import { batchedDayRows, planReads, type DayRange } from "@/lib/counter/day-batch"

const r = (first: string, last: string): DayRange => ({ first, last })

describe("planReads", () => {
  it("merges overlapping ranges into one read", () => {
    const plans = planReads([r("2026-09-28", "2026-11-20"), r("2026-09-24", "2026-11-19")])
    expect(plans).toEqual([{ read: r("2026-09-24", "2026-11-20"), members: [1, 0] }])
  })

  it("folds a day inside a long range into it", () => {
    const plans = planReads([r("2026-11-19", "2026-11-19"), r("2026-08-31", "2026-11-19")])
    expect(plans).toEqual([{ read: r("2026-08-31", "2026-11-19"), members: [1, 0] }])
  })

  it("never reads more days than the separate reads would", () => {
    // Yesterday and the same day last week: one 8-day read would read 6 days
    // nobody asked for, so they stay two reads.
    const plans = planReads([r("2026-11-19", "2026-11-19"), r("2026-11-12", "2026-11-12")])
    expect(plans.map((p) => p.read)).toEqual([r("2026-11-12", "2026-11-12"), r("2026-11-19", "2026-11-19")])
  })
})

describe("batchedDayRows", () => {
  const rows = [
    { day: "2026-11-10", v: 1 },
    { day: "2026-11-12", v: 2 },
    { day: "2026-11-19", v: 3 },
  ]

  it("shares one read and gives each caller only its own days, as its own copy", async () => {
    const load = vi.fn(async (range: DayRange) =>
      rows.filter((x) => x.day >= range.first && x.day <= range.last),
    )
    const ask = (range: DayRange) =>
      batchedDayRows({ group: "g1", range, load, dayOf: (x) => x.day })

    const [wide, narrow] = await Promise.all([ask(r("2026-11-10", "2026-11-19")), ask(r("2026-11-12", "2026-11-19"))])
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(r("2026-11-10", "2026-11-19"))
    expect(wide.map((x) => x.v)).toEqual([1, 2, 3])
    expect(narrow.map((x) => x.v)).toEqual([2, 3])
    narrow[0].v = 99
    expect(wide[1].v).toBe(2)
  })

  it("fails every caller of a failed read", async () => {
    const load = vi.fn(async () => {
      throw new Error("down")
    })
    const ask = (range: DayRange) =>
      batchedDayRows({ group: "g2", range, load, dayOf: (x: { day: string }) => x.day })
    const results = await Promise.allSettled([ask(r("2026-11-10", "2026-11-12")), ask(r("2026-11-11", "2026-11-12"))])
    expect(results.map((x) => x.status)).toEqual(["rejected", "rejected"])
    expect(load).toHaveBeenCalledTimes(1)
  })
})
