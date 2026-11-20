import { describe, expect, it } from "vitest"
import {
  missedPunches,
  missedPunchesText,
  timeRecordsGroup,
  timeRecordsHeadline,
  timeRecordsNeed,
} from "@/lib/counter/time-records"

describe("missedPunches", () => {
  it("counts missed clock-ins and clock-outs off ledger rows, and nothing else", () => {
    const m = missedPunches([
      { code: "MISSED_CLOCK_IN", alerts: 13 },
      { code: "MISSED_CLOCK_OUT_OT_NOW", alerts: 3 },
      { code: "UNSCHEDULED_CLOCK_IN", alerts: 2 },
      { code: "LATE_CLOCK_OUT", alerts: 28 },
    ])
    expect(m).toEqual({ missedIn: 13, missedOut: 3 })
  })

  it("counts raw alert rows one each", () => {
    expect(missedPunches([{ alertCode: "MISSED_CLOCK_IN" }, { alertCode: "MISSED_CLOCK_IN" }])).toEqual({
      missedIn: 2,
      missedOut: 0,
    })
  })
})

describe("timeRecordsHeadline", () => {
  it("leads with the fix in plain words", () => {
    expect(timeRecordsHeadline({ missedIn: 13, missedOut: 3 })).toBe(
      "Time records need fixing: 13 missed clock-ins, 3 missed clock-outs",
    )
    expect(missedPunchesText({ missedIn: 0, missedOut: 1 })).toBe("1 missed clock-out")
  })

  it("is null with nothing to fix", () => {
    expect(timeRecordsHeadline({ missedIn: 0, missedOut: 0 })).toBeNull()
  })
})

describe("timeRecordsNeed / timeRecordsGroup", () => {
  it("names the stores, most first, and says Harri does not report fixes", () => {
    const need = timeRecordsNeed(
      [
        { alertCode: "MISSED_CLOCK_OUT_OT_NOW", storeName: "Glendale" },
        { alertCode: "MISSED_CLOCK_IN", storeName: "Hollywood" },
        { alertCode: "MISSED_CLOCK_IN", storeName: "Hollywood" },
      ],
      "2026-11-13",
      "2026-11-19",
    )
    expect(need).toMatchObject({ missedIn: 2, missedOut: 1, stores: ["Hollywood", "Glendale"] })
    const g = timeRecordsGroup(need!)
    expect(g.what).toBe("Time records need fixing: 2 missed clock-ins, 1 missed clock-out")
    expect(g.why).toContain("at Hollywood and Glendale")
    expect(g.why).toContain("Harri does not tell us when one is fixed")
    expect(g.action.href).toBe("/dashboard/labor")
  })

  it("is null with no missed punch, so no empty group is shown", () => {
    expect(timeRecordsNeed([], "2026-11-13", "2026-11-19")).toBeNull()
  })
})
