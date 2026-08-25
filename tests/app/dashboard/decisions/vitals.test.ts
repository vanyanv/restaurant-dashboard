// The page opened with a seven-cell calendar and no reading of the week as a
// whole — the owner had to add seven numbers in their head to answer "how big
// is this week". These tests pin the four Act I cells, and above all pin the
// places where the honest answer is "we don't know" rather than a number
// assembled from partial data.

import { describe, it, expect } from "vitest"
import {
  accuracySubtitle,
  computeVitals,
  type VitalsDay,
} from "@/app/dashboard/(editorial)/decisions/lib/vitals"
import type { Scorecard } from "@/app/dashboard/(editorial)/decisions/lib/scorecard"

const day = (over: Partial<VitalsDay> = {}): VitalsDay => ({
  predictedRevenue: 8000,
  p10: 7000,
  p90: 9000,
  pctVsTrailing: null,
  labor: {
    scheduledHours: 100,
    neededHours: 100,
    gapHours: 0,
    status: "level",
    unfilledSlots: 0,
  },
  ...over,
})

const week = (over: Partial<VitalsDay> = {}): VitalsDay[] =>
  Array.from({ length: 7 }, () => day(over))

const scorecard = (over: Partial<Scorecard> = {}): Scorecard => ({
  wape: 0.064,
  baselineWape: 0.093,
  beatsBaselineBy: 0.3118,
  intervalCoverage80: 0.81,
  coverageTarget: 0.8,
  coverageMeetsTarget: true,
  sampleSize: 26,
  ...over,
})

describe("computeVitals — week forecast", () => {
  it("sums the seven days", () => {
    const v = computeVitals({ days: week(), scorecard: null })
    expect(v.weekForecast.total).toBe(56000)
    expect(v.weekForecast.daysCounted).toBe(7)
  })

  it("sums the band when every day carries one", () => {
    const v = computeVitals({ days: week(), scorecard: null })
    expect(v.weekForecast.p10).toBe(49000)
    expect(v.weekForecast.p90).toBe(63000)
  })

  // A band summed over five of seven days is narrower than the truth, and it
  // would render as though the model were more certain than it is.
  it("withholds the band when any day is missing one", () => {
    const days = week()
    days[3] = day({ p10: null, p90: null })
    const v = computeVitals({ days, scorecard: null })
    expect(v.weekForecast.total).toBe(56000)
    expect(v.weekForecast.p10).toBeNull()
    expect(v.weekForecast.p90).toBeNull()
  })

  it("reports an empty week as zero days, not as $0", () => {
    const v = computeVitals({ days: [], scorecard: null })
    expect(v.weekForecast.daysCounted).toBe(0)
    expect(v.weekForecast.total).toBeNull()
  })
})

describe("computeVitals — labor gap", () => {
  it("adds the daily gaps into one week-level number", () => {
    const days = week({
      labor: { scheduledHours: 85, neededHours: 100, gapHours: -15, status: "short", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    expect(v.laborGap.hours).toBe(-105)
    expect(v.laborGap.status).toBe("short")
  })

  it("calls a week level when the gap sits inside SPLH tolerance", () => {
    // needed 700h total, tolerance 10% = 70h of slack; 21h short is level.
    const days = week({
      labor: { scheduledHours: 97, neededHours: 100, gapHours: -3, status: "level", unfilledSlots: 0 },
    })
    expect(computeVitals({ days, scorecard: null }).laborGap.status).toBe("level")
  })

  // The lane compares with a strict `<`, so a day exactly at tolerance is
  // level. Seven such days must not sum into a week the page calls short —
  // the day cells would all read level under a masthead saying otherwise.
  it("agrees with the lane at exactly the tolerance boundary", () => {
    const days = week({
      labor: { scheduledHours: 90, neededHours: 100, gapHours: -10, status: "level", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    expect(v.laborGap.hours).toBe(-70)
    expect(v.laborGap.status).toBe("level")
  })

  it("flags an over-staffed week as heavy", () => {
    const days = week({
      labor: { scheduledHours: 130, neededHours: 100, gapHours: 30, status: "heavy", unfilledSlots: 0 },
    })
    expect(computeVitals({ days, scorecard: null }).laborGap.status).toBe("heavy")
  })

  // Days short and days heavy cancel in the sum. The count keeps the detail the
  // total throws away, so the cell can say "3 days short" instead of "level".
  it("counts short days separately from the net total", () => {
    const days = week()
    days[5] = day({
      labor: { scheduledHours: 60, neededHours: 100, gapHours: -40, status: "short", unfilledSlots: 0 },
    })
    days[6] = day({
      labor: { scheduledHours: 140, neededHours: 100, gapHours: 40, status: "heavy", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    expect(v.laborGap.hours).toBe(0)
    expect(v.laborGap.shortDays).toBe(1)
  })

  it("reports unknown when no day could be judged", () => {
    const days = week({
      labor: { scheduledHours: 0, neededHours: null, gapHours: null, status: "unknown", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    expect(v.laborGap.status).toBe("unknown")
    expect(v.laborGap.hours).toBeNull()
  })

  // "Nobody has published a schedule" is a different conversation from "the
  // schedule is thin", and the lane already distinguishes them.
  it("counts days with no schedule published", () => {
    const days = week()
    days[0] = day({
      labor: { scheduledHours: 0, neededHours: 100, gapHours: null, status: "unscheduled", unfilledSlots: 0 },
    })
    expect(computeVitals({ days, scorecard: null }).laborGap.unscheduledDays).toBe(1)
  })
})

describe("computeVitals — sales per labor hour", () => {
  it("divides the week's forecast by the hours posted for it", () => {
    const v = computeVitals({ days: week(), scorecard: null })
    // 56,000 / 700h
    expect(v.splh.actual).toBeCloseTo(80, 5)
  })

  // needed = revenue / targetSplh, so the target is recoverable without
  // re-reading weekdayTargets() and risking a different answer than the lane's.
  it("recovers the target the lane measured against", () => {
    const days = week({
      labor: { scheduledHours: 90, neededHours: 80, gapHours: 10, status: "heavy", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    // 56,000 / 560h needed
    expect(v.splh.target).toBeCloseTo(100, 5)
  })

  it("withholds a rate when nothing is scheduled", () => {
    const days = week({
      labor: { scheduledHours: 0, neededHours: 100, gapHours: null, status: "unscheduled", unfilledSlots: 0 },
    })
    const v = computeVitals({ days, scorecard: null })
    expect(v.splh.actual).toBeNull()
    expect(v.splh.status).toBe("unknown")
  })

  it("reads above target when the week is staffed lean", () => {
    const days = week({
      labor: { scheduledHours: 70, neededHours: 100, gapHours: -30, status: "short", unfilledSlots: 0 },
    })
    // 56,000/490h = $114 against a $80 target
    expect(computeVitals({ days, scorecard: null }).splh.status).toBe("above")
  })
})

describe("computeVitals — forecast accuracy", () => {
  it("passes the scorecard's reading through", () => {
    const v = computeVitals({ days: week(), scorecard: scorecard() })
    expect(v.accuracy?.wape).toBeCloseTo(0.064, 5)
    expect(v.accuracy?.sampleSize).toBe(26)
  })

  it("is null when the model has no track record yet", () => {
    expect(computeVitals({ days: week(), scorecard: null }).accuracy).toBeNull()
  })

  // A scorecard row with no reconciled days behind it is informational; showing
  // "0.0% miss" off an empty sample would be the flattering reading the
  // scorecard exists to prevent.
  it("is null when no days were reconciled", () => {
    const v = computeVitals({ days: week(), scorecard: scorecard({ sampleSize: 0 }) })
    expect(v.accuracy).toBeNull()
  })
})

// The live page read "beats naive by -89%" on 2026-08-20, while the scorecard
// six inches below it read "worse than last week's same day" off the same
// number. Fixtures never caught it because every fixture had the model winning.
describe("accuracySubtitle", () => {
  it("claims a win only when there is one", () => {
    expect(accuracySubtitle({ beatsBaselineBy: 0.31, sampleSize: 26 })).toBe(
      "avg miss · beats a simple guess by 31%",
    )
  })

  it("says plainly that a loss is a loss", () => {
    expect(accuracySubtitle({ beatsBaselineBy: -0.89, sampleSize: 26 })).toBe(
      "avg miss · 89% worse than a simple guess",
    )
  })

  it("never prints a negative percentage after the word 'beats'", () => {
    for (const b of [-2, -0.89, -0.01, 0, 0.01, 1.5]) {
      const out = accuracySubtitle({ beatsBaselineBy: b, sampleSize: 26 })
      expect(out).not.toMatch(/beats.*−|beats.*-\d/)
    }
  })

  it("treats a dead heat as not losing", () => {
    expect(accuracySubtitle({ beatsBaselineBy: 0, sampleSize: 26 })).toBe(
      "avg miss · beats a simple guess by 0%",
    )
  })

  it("falls back to the sample size when there is no baseline", () => {
    expect(accuracySubtitle({ beatsBaselineBy: null, sampleSize: 26 })).toBe(
      "avg miss over 26 days",
    )
    expect(accuracySubtitle({ beatsBaselineBy: null, sampleSize: 1 })).toBe(
      "avg miss over 1 day",
    )
  })
})
