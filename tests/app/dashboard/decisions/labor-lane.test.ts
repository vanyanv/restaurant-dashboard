// The week ribbon showed staffing as `+1` / `-1` / "no schedule" — a direction
// with no magnitude, and for six of seven days not even that, because
// classifyStaffingRisk sourced scheduled labor from HarriDailyLabor.forecastCost
// which has no forward rows. HarriShift has the published schedule in hours.
//
// "Needed" is the store's own median sales-per-labor-hour for that weekday
// (via weekdayTargets in lib/splh), not a configured target nobody set. So the
// lane reads "you are staffed for a typical Saturday" or "you are not", which is
// a claim the data can actually support.

import { describe, it, expect } from "vitest"
import { computeLaborLane } from "@/lib/decisions/labor-lane"

const base = { forecastRevenue: 8000, scheduledHours: 70, targetSplh: 100, unfilledSlots: 0 }

describe("computeLaborLane", () => {
  it("turns a forecast into the hours it would take at typical productivity", () => {
    const lane = computeLaborLane({ ...base, forecastRevenue: 8000, targetSplh: 100 })
    expect(lane.neededHours).toBe(80)
  })

  it("reports the shortfall in hours, not a direction arrow", () => {
    const lane = computeLaborLane({ ...base, scheduledHours: 70, forecastRevenue: 8000, targetSplh: 100 })
    expect(lane.gapHours).toBe(-10)
    expect(lane.status).toBe("short")
  })

  it("flags a day carrying more hours than its forecast earns", () => {
    const lane = computeLaborLane({ ...base, scheduledHours: 95, forecastRevenue: 8000, targetSplh: 100 })
    expect(lane.gapHours).toBe(15)
    expect(lane.status).toBe("heavy")
  })

  it("treats a small gap as level — weather and event noise shouldn't light up the week", () => {
    // 80 needed, 10% tolerance => anything within +/- 8h is level.
    expect(computeLaborLane({ ...base, scheduledHours: 75 }).status).toBe("level")
    expect(computeLaborLane({ ...base, scheduledHours: 86 }).status).toBe("level")
    expect(computeLaborLane({ ...base, scheduledHours: 71 }).status).toBe("short")
    expect(computeLaborLane({ ...base, scheduledHours: 89 }).status).toBe("heavy")
  })

  it("separates 'nobody has published a schedule' from 'the schedule is thin'", () => {
    const lane = computeLaborLane({ ...base, scheduledHours: 0 })
    expect(lane.status).toBe("unscheduled")
    expect(lane.gapHours).toBeNull()
  })

  it("says nothing when the weekday has no productivity history to judge against", () => {
    const lane = computeLaborLane({ ...base, targetSplh: null })
    expect(lane.status).toBe("unknown")
    expect(lane.neededHours).toBeNull()
    expect(lane.gapHours).toBeNull()
  })

  it("refuses a nonsensical target rather than dividing by it", () => {
    expect(computeLaborLane({ ...base, targetSplh: 0 }).status).toBe("unknown")
    expect(computeLaborLane({ ...base, targetSplh: -50 }).status).toBe("unknown")
  })

  it("carries unfilled slots through — rare (11 of 3,737 shifts) but worth flagging", () => {
    expect(computeLaborLane({ ...base, unfilledSlots: 2 }).unfilledSlots).toBe(2)
  })

  it("rounds hours to a tenth so the cell doesn't render 69.99999", () => {
    const lane = computeLaborLane({ ...base, forecastRevenue: 8488, targetSplh: 126.3, scheduledHours: 67.5 })
    expect(lane.neededHours).toBe(67.2)
    expect(lane.gapHours).toBe(0.3)
  })

  it("handles a day with no forecast", () => {
    const lane = computeLaborLane({ ...base, forecastRevenue: 0 })
    expect(lane.status).toBe("unknown")
  })
})
