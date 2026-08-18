import { describe, it, expect } from "vitest"
import {
  median,
  blendedHourlyRate,
  weekdayTargets,
  buildSplhSeries,
  buildSplhSeriesRolling,
  rollToWeeks,
  type SplhInput,
} from "@/lib/splh"

const row = (date: string, netSales: number, laborHours: number, laborCost = laborHours * 20): SplhInput => ({
  date, netSales, laborHours, laborCost,
})

describe("median", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it("averages the two middle values for even counts", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it("returns null for an empty list", () => {
    expect(median([])).toBeNull()
  })
})

describe("blendedHourlyRate", () => {
  it("divides total cost by total hours, not the mean of per-day rates", () => {
    // Day-weighted: (100+300)/(10+10) = 20. A naive mean of rates would give
    // the same here, so use uneven hours to actually distinguish them.
    const rows = [row("2026-08-10", 0, 10, 100), row("2026-08-11", 0, 30, 900)]
    expect(blendedHourlyRate(rows)).toBeCloseTo(1000 / 40, 6)
  })
  it("returns null when there are no hours", () => {
    expect(blendedHourlyRate([row("2026-08-10", 500, 0, 0)])).toBeNull()
  })
})

describe("weekdayTargets", () => {
  it("computes a per-weekday median SPLH", () => {
    // 2026-08-10 and 2026-08-17 are both Mondays.
    const rows = [
      row("2026-08-10", 1000, 10), // 100
      row("2026-08-17", 1400, 10), // 140
      row("2026-08-11", 600, 10),  // Tue 60
    ]
    const t = weekdayTargets(rows)
    expect(t[1]).toBeCloseTo(120, 6) // Monday median of 100 & 140
    expect(t[2]).toBeCloseTo(60, 6)  // Tuesday
  })

  it("ignores days with zero hours instead of dividing by zero", () => {
    const rows = [row("2026-08-10", 1000, 10), row("2026-08-17", 900, 0, 0)]
    expect(t2(rows)).toBeCloseTo(100, 6)
  })
  const t2 = (rows: SplhInput[]) => weekdayTargets(rows)[1] as number
})

describe("buildSplhSeries", () => {
  const history = [
    row("2026-08-03", 1000, 10), // Mon 100
    row("2026-08-10", 1000, 10), // Mon 100
  ]

  it("computes splh, earned hours and variance against the weekday target", () => {
    // Monday target 100. Actual: $1200 over 15h -> splh 80, earned 12h,
    // variance +3h overstaffed, at $20/h = $60.
    const [p] = buildSplhSeries([row("2026-08-17", 1200, 15, 300)], history)
    expect(p.splh).toBeCloseTo(80, 6)
    expect(p.targetSplh).toBeCloseTo(100, 6)
    expect(p.earnedHours).toBeCloseTo(12, 6)
    expect(p.varianceHours).toBeCloseTo(3, 6)
    expect(p.varianceDollars).toBeCloseTo(60, 6)
    expect(p.status).toBe("over")
  })

  it("marks a day inside the tolerance band as on-target", () => {
    const [p] = buildSplhSeries([row("2026-08-17", 1050, 10)], history)
    expect(p.splh).toBeCloseTo(105, 6)
    expect(p.status).toBe("on")
  })

  it("marks a day well above target as under-staffed, not as a win", () => {
    const [p] = buildSplhSeries([row("2026-08-17", 1500, 10)], history)
    expect(p.status).toBe("under")
  })

  it("yields a null splh (not Infinity) when a day has sales but no hours", () => {
    const [p] = buildSplhSeries([row("2026-08-17", 1500, 0, 0)], history)
    expect(p.splh).toBeNull()
    expect(p.status).toBe("unknown")
    expect(Number.isFinite(p.splh as number)).toBe(false)
  })

  it("returns a null target when that weekday has no history", () => {
    const [p] = buildSplhSeries([row("2026-08-19", 1000, 10)], history) // Wednesday
    expect(p.targetSplh).toBeNull()
    expect(p.varianceHours).toBeNull()
    expect(p.status).toBe("unknown")
  })

  it("preserves input order", () => {
    const pts = buildSplhSeries(
      [row("2026-08-17", 1000, 10), row("2026-08-18", 1000, 10)],
      history
    )
    expect(pts.map((p) => p.date)).toEqual(["2026-08-17", "2026-08-18"])
  })
})

describe("rollToWeeks", () => {
  it("sums sales and hours into Monday-anchored weeks", () => {
    const rows = [
      row("2026-08-10", 1000, 10), // Mon
      row("2026-08-16", 1000, 10), // Sun, same ISO week
      row("2026-08-17", 500, 10),  // next Mon
    ]
    const weeks = rollToWeeks(rows)
    expect(weeks).toHaveLength(2)
    expect(weeks[0].date).toBe("2026-08-10")
    expect(weeks[0].netSales).toBe(2000)
    expect(weeks[0].laborHours).toBe(20)
    expect(weeks[1].date).toBe("2026-08-17")
  })

  it("returns weeks in ascending order", () => {
    const weeks = rollToWeeks([row("2026-08-17", 1, 1), row("2026-08-03", 1, 1)])
    expect(weeks.map((w) => w.date)).toEqual(["2026-08-03", "2026-08-17"])
  })
})

describe("rollToWeeks dropPartial", () => {
  const day = (iso: string) => ({ date: iso, netSales: 100, laborHours: 10, laborCost: 200 })
  const fullWeek = (mon: string) => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon + "T00:00:00.000Z")
      d.setUTCDate(d.getUTCDate() + i)
      out.push(day(d.toISOString().slice(0, 10)))
    }
    return out
  }

  it("drops an in-progress week so one day can't render as a full bar", () => {
    const rows = [...fullWeek("2026-08-10"), day("2026-08-17")]
    const weeks = rollToWeeks(rows, { dropPartial: true })
    expect(weeks.map((w) => w.date)).toEqual(["2026-08-10"])
  })

  it("keeps partial weeks when not asked to drop them", () => {
    const rows = [...fullWeek("2026-08-10"), day("2026-08-17")]
    expect(rollToWeeks(rows)).toHaveLength(2)
  })

  it("keeps a complete week", () => {
    expect(rollToWeeks(fullWeek("2026-08-10"), { dropPartial: true })).toHaveLength(1)
  })
})

describe("buildSplhSeriesRolling", () => {
  const wk = (date: string, netSales: number, laborHours: number) => ({
    date, netSales, laborHours, laborCost: laborHours * 20,
  })

  it("scores each entry against the median of the preceding window only", () => {
    // Three priors at 100/110/120 (median 110), then the scored week at 88.
    const seq = [
      wk("2026-07-06", 1000, 10),
      wk("2026-07-13", 1100, 10),
      wk("2026-07-20", 1200, 10),
      wk("2026-07-27", 880, 10),
    ]
    const [p] = buildSplhSeriesRolling(seq, 1, 8, { weekly: true })
    expect(p.date).toBe("2026-07-27")
    expect(p.splh).toBeCloseTo(88, 6)
    expect(p.targetSplh).toBeCloseTo(110, 6)
    expect(p.status).toBe("over")
  })

  it("does not let an entry score against itself", () => {
    const seq = [wk("2026-07-06", 1000, 10), wk("2026-07-13", 5000, 10)]
    const [, second] = buildSplhSeriesRolling(seq, 2, 8, { weekly: true })
    expect(second.targetSplh).toBeCloseTo(100, 6) // only the first entry
  })

  it("leaves the very first entry without a target rather than inventing one", () => {
    const seq = [wk("2026-07-06", 1000, 10), wk("2026-07-13", 1000, 10)]
    const [first] = buildSplhSeriesRolling(seq, 2, 8, { weekly: true })
    expect(first.targetSplh).toBeNull()
    expect(first.status).toBe("unknown")
  })

  it("honours the window size, ignoring entries older than it", () => {
    const seq = [
      wk("2026-06-01", 9000, 10), // 900 — far outside a window of 2
      wk("2026-06-08", 1000, 10), // 100
      wk("2026-06-15", 1000, 10), // 100
      wk("2026-06-22", 1000, 10),
    ]
    const [p] = buildSplhSeriesRolling(seq, 1, 2, { weekly: true })
    expect(p.targetSplh).toBeCloseTo(100, 6)
  })

  it("returns only the requested number of points", () => {
    const seq = Array.from({ length: 10 }, (_, i) =>
      wk(`2026-06-0${(i % 9) + 1}`, 1000, 10)
    )
    expect(buildSplhSeriesRolling(seq, 3, 8)).toHaveLength(3)
  })
})
