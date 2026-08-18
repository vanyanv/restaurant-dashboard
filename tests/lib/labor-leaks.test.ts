import { describe, it, expect } from "vitest"
import {
  computeClockDrift,
  worstHourBlock,
  worstDay,
  rankLeaks,
} from "@/lib/labor-leaks"

const alert = (alertCode: string, minutes: number, userId = 1, employeeName = "Jorge Lopez") => ({
  alertCode, timeDiffSec: minutes * 60, userId, employeeName,
})

describe("computeClockDrift", () => {
  it("counts early clock-ins and late clock-outs as ADDED paid time", () => {
    const d = computeClockDrift([alert("EARLY_CLOCK_IN", 60), alert("LATE_CLOCK_OUT", 30)], 20)
    expect(d.addedHours).toBeCloseTo(1.5, 6)
    expect(d.addedCost).toBeCloseTo(30, 6)
    expect(d.addedCount).toBe(2)
  })

  it("counts late clock-ins and early clock-outs as SAVED time, not cost", () => {
    const d = computeClockDrift([alert("LATE_CLOCK_IN", 60), alert("EARLY_CLOCK_OUT", 60)], 20)
    expect(d.addedHours).toBe(0)
    expect(d.savedHours).toBeCloseTo(2, 6)
    expect(d.netHours).toBeCloseTo(-2, 6)
  })

  it("nets added against saved", () => {
    const d = computeClockDrift([alert("EARLY_CLOCK_IN", 120), alert("LATE_CLOCK_IN", 60)], 20)
    expect(d.netHours).toBeCloseTo(1, 6)
    expect(d.netCost).toBeCloseTo(20, 6)
  })

  it("ignores alert types that carry no time difference", () => {
    // MISSED_* and UNSCHEDULED_* arrive with timeDiffSec 0 or null.
    const d = computeClockDrift(
      [{ alertCode: "MISSED_CLOCK_OUT_OT_NOW", timeDiffSec: 0, userId: 1 },
       { alertCode: "UNSCHEDULED_CLOCK_IN", timeDiffSec: null, userId: 1 }],
      20
    )
    expect(d.addedHours).toBe(0)
    expect(d.addedCount).toBe(0)
  })

  it("treats a negative time diff as magnitude", () => {
    const d = computeClockDrift([alert("EARLY_CLOCK_IN", -60)], 20)
    expect(d.addedHours).toBeCloseTo(1, 6)
  })

  it("names the biggest contributor", () => {
    const d = computeClockDrift(
      [alert("EARLY_CLOCK_IN", 30, 1, "Jorge Lopez"),
       alert("EARLY_CLOCK_IN", 90, 2, "Maria Ruiz"),
       alert("EARLY_CLOCK_IN", 30, 2, "Maria Ruiz")],
      20
    )
    expect(d.topContributor?.name).toBe("Maria Ruiz")
    expect(d.topContributor?.hours).toBeCloseTo(2, 6)
    expect(d.topContributor?.count).toBe(2)
  })

  it("falls back to a user id when the name is unknown", () => {
    const d = computeClockDrift([{ alertCode: "EARLY_CLOCK_IN", timeDiffSec: 3600, userId: 99 }], 20)
    expect(d.topContributor?.name).toBe("User 99")
  })

  it("returns zero cost when no blended rate is known", () => {
    const d = computeClockDrift([alert("EARLY_CLOCK_IN", 60)], null)
    expect(d.addedHours).toBeCloseTo(1, 6)
    expect(d.addedCost).toBe(0)
  })
})

const hour = (h: number, staffedHours: number, netSales: number) => ({
  hour: h, staffedHours, netSales, splh: staffedHours > 0 ? netSales / staffedHours : null,
})

describe("worstHourBlock", () => {
  it("flags hours earning under half the week's own rate", () => {
    // Week rate: 1100/11 = 100. Floor 50. Hour 9 earns 10.
    const b = worstHourBlock([hour(9, 10, 100), hour(19, 1, 1000)], 20)
    expect(b?.hours).toEqual([9])
    expect(b?.staffedHours).toBeCloseTo(10, 6)
    expect(b?.cost).toBeCloseTo(200, 6)
  })

  it("returns null when every staffed hour clears the floor", () => {
    expect(worstHourBlock([hour(19, 10, 1000), hour(20, 10, 1000)], 20)).toBeNull()
  })

  it("returns null with no staffed hours at all", () => {
    expect(worstHourBlock([hour(9, 0, 0)], 20)).toBeNull()
  })

  it("ignores unstaffed hours even when they have no sales", () => {
    const b = worstHourBlock([hour(3, 0, 0), hour(9, 10, 100), hour(19, 1, 1000)], 20)
    expect(b?.hours).toEqual([9])
  })

  it("honours a custom share threshold", () => {
    // Rate 100, share 0.2 -> floor 20. Hour 9 at 10 still flags; hour 10 at 50 does not.
    const b = worstHourBlock([hour(9, 10, 100), hour(10, 10, 500), hour(19, 1, 500)], 20, 0.2)
    expect(b?.hours).toEqual([9])
  })
})

describe("worstDay", () => {
  const day = (weekday: string, varianceDollars: number | null) => ({
    date: "2026-08-11", weekday, varianceHours: 1, varianceDollars, splh: 100, status: "over",
  })

  it("picks the day with the largest positive variance", () => {
    expect(worstDay([day("Mon", 50), day("Tue", 130), day("Wed", 90)])?.weekday).toBe("Tue")
  })

  it("returns null when no day is over", () => {
    expect(worstDay([day("Mon", -50), day("Tue", null)])).toBeNull()
  })
})

describe("rankLeaks", () => {
  const drift = computeClockDrift([alert("EARLY_CLOCK_IN", 60)], 20) // $20
  const block = worstHourBlock([hour(9, 10, 100), hour(19, 1, 1000)], 20) // $200
  const day = { date: "2026-08-11", weekday: "Tue", varianceHours: 6.4, varianceDollars: 131, splh: 103, status: "over" }

  it("orders leaks by dollars, largest first", () => {
    const leaks = rankLeaks({ drift, block, day })
    expect(leaks.map((l) => l.id)).toEqual(["hours", "day", "drift"])
  })

  it("gives every leak a basis so the amounts are not read as a total", () => {
    for (const l of rankLeaks({ drift, block, day })) {
      expect(l.basis.length).toBeGreaterThan(0)
      expect(l.action.length).toBeGreaterThan(0)
    }
  })

  it("omits drift below half an hour rather than showing noise", () => {
    const tiny = computeClockDrift([alert("EARLY_CLOCK_IN", 5)], 20)
    expect(rankLeaks({ drift: tiny, block: null, day: null })).toHaveLength(0)
  })

  it("returns an empty ledger for a clean week", () => {
    const clean = computeClockDrift([], 20)
    expect(rankLeaks({ drift: clean, block: null, day: null })).toEqual([])
  })

  it("names the contributor in the drift evidence", () => {
    const [leak] = rankLeaks({ drift, block: null, day: null })
    expect(leak.evidence).toContain("Jorge Lopez")
  })
})
