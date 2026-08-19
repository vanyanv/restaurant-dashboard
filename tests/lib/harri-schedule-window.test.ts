// The schedule sync was never wired into a cron — `runHarriScheduleSync` had
// exactly one caller, `scripts/backfill-harri-schedule.ts`. So HarriShift only
// moved when someone ran that script by hand, and on 2026-08-19 it held nothing
// past Aug 23 even though Harri had the week of Aug 24 published and available.
//
// Probing the gateway that day: week +0 returned 64 shifts, week +1 returned 63
// (437h, Aug 24-30), weeks +2 and +3 came back empty. So the publishing horizon
// is about two weeks, and the sync window has to reach it.
//
// Backward coverage matters too: managers edit a published week, and the sync
// replaces a week wholesale rather than upserting, so a re-fetch is how an edit
// or a deletion reaches us.

import { describe, it, expect } from "vitest"
import {
  scheduleSyncWindow,
  SCHEDULE_LOOKAHEAD_DAYS,
  SCHEDULE_LOOKBACK_DAYS,
} from "@/lib/harri-schedule"

const at = (iso: string) => new Date(`${iso}T09:30:00Z`)
const key = (d: Date) => d.toISOString().slice(0, 10)

describe("scheduleSyncWindow", () => {
  it("reaches far enough forward to cover Harri's publishing horizon", () => {
    // Measured 2026-08-19: week +1 published, week +2 empty.
    expect(SCHEDULE_LOOKAHEAD_DAYS).toBeGreaterThanOrEqual(14)
  })

  it("would have caught the week the page was missing", () => {
    const { startDate, endDate } = scheduleSyncWindow(at("2026-08-19"))
    // Aug 24-30 was published and absent from the database.
    expect(key(startDate) <= "2026-08-24").toBe(true)
    expect(key(endDate) >= "2026-08-30").toBe(true)
  })

  it("looks back far enough to pick up edits to an already-published week", () => {
    const { startDate } = scheduleSyncWindow(at("2026-08-19"))
    expect(key(startDate)).toBe("2026-08-12")
    expect(SCHEDULE_LOOKBACK_DAYS).toBeGreaterThanOrEqual(7)
  })

  it("normalises to UTC midnight so a run at 23:07 covers the same days as one at 06:00", () => {
    const late = scheduleSyncWindow(new Date("2026-08-19T23:07:00Z"))
    const early = scheduleSyncWindow(new Date("2026-08-19T06:00:00Z"))
    expect(key(late.startDate)).toBe(key(early.startDate))
    expect(key(late.endDate)).toBe(key(early.endDate))
    expect(late.startDate.getUTCHours()).toBe(0)
    expect(late.endDate.getUTCHours()).toBe(0)
  })

  it("crosses a month boundary without losing days", () => {
    const { startDate, endDate } = scheduleSyncWindow(at("2026-08-28"))
    expect(key(startDate)).toBe("2026-08-21")
    expect(key(endDate)).toBe("2026-09-11")
  })
})
