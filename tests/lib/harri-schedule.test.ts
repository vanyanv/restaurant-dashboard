import { describe, it, expect } from "vitest"
import {
  parseHarriDateTime,
  formatHarriWeekParam,
  flattenSchedule,
  bucketShiftHours,
} from "@/lib/harri-schedule"

const iso = (d: Date | null) => (d ? d.toISOString() : null)

describe("parseHarriDateTime", () => {
  it("parses Harri's '%b %d, %Y %H:%M' into UTC-encoded local wall-clock", () => {
    // 09:00 local must come back as 09:00 UTC so getUTCHours() === 9.
    expect(iso(parseHarriDateTime("Aug 10, 2026 09:00"))).toBe("2026-08-10T09:00:00.000Z")
  })

  it("parses a past-midnight end time on the following date", () => {
    expect(iso(parseHarriDateTime("Aug 11, 2026 01:00"))).toBe("2026-08-11T01:00:00.000Z")
  })

  it("handles single-digit days", () => {
    expect(iso(parseHarriDateTime("Sep 3, 2026 14:30"))).toBe("2026-09-03T14:30:00.000Z")
  })

  it("returns null for an unparseable string rather than an Invalid Date", () => {
    expect(parseHarriDateTime("2026-08-10T09:00")).toBeNull()
    expect(parseHarriDateTime("Foo 10, 2026 09:00")).toBeNull()
    expect(parseHarriDateTime("")).toBeNull()
  })
})

describe("formatHarriWeekParam", () => {
  it("formats a Date as the '%b %d, %Y' the endpoint demands", () => {
    expect(formatHarriWeekParam(new Date("2026-08-10T00:00:00.000Z"))).toBe("Aug 10, 2026")
  })
  it("zero-pads the day", () => {
    expect(formatHarriWeekParam(new Date("2026-09-03T00:00:00.000Z"))).toBe("Sep 03, 2026")
  })
})

// Minimal shape mirroring the live response.
const response = {
  schedule: [
    {
      id: 1,
      start_date: "Aug 10, 2026",
      status: "PUBLISHED",
      roles: [
        {
          position: {
            code: "line-cook-5",
            name: "Line Cook",
            category: { code: "QS", name: "Quick Service" },
          },
          role_days: [
            {
              date: "Aug 10, 2026",
              assignees: [
                {
                  user_id: 488841,
                  type: "USER",
                  assignee_shifts: [
                    { id: 643561648, start_time: "Aug 10, 2026 09:00", end_time: "Aug 10, 2026 17:00", status: "PUBLISHED" },
                  ],
                },
                // Unfilled placeholder slot — must not count as staffed labor.
                { user_id: null, type: "VIRTUAL", assignee_shifts: [] },
              ],
            },
            {
              date: "Aug 10, 2026",
              assignees: [
                {
                  user_id: 1135033,
                  type: "USER",
                  assignee_shifts: [
                    { id: 643561649, start_time: "Aug 10, 2026 18:00", end_time: "Aug 11, 2026 01:00", status: "PUBLISHED" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe("flattenSchedule", () => {
  const weekStart = new Date("2026-08-10T00:00:00.000Z")

  it("returns one row per real assignee shift", () => {
    const rows = flattenSchedule(response as never, weekStart)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.harriShiftId)).toEqual([643561648, 643561649])
  })

  it("carries position and category through", () => {
    const [r] = flattenSchedule(response as never, weekStart)
    expect(r.positionCode).toBe("line-cook-5")
    expect(r.positionName).toBe("Line Cook")
    expect(r.categoryCode).toBe("QS")
  })

  it("computes minutes, including across midnight", () => {
    const rows = flattenSchedule(response as never, weekStart)
    expect(rows[0].minutes).toBe(8 * 60)
    expect(rows[1].minutes).toBe(7 * 60) // 18:00 -> 01:00 next day
  })

  it("dates a shift by its START day", () => {
    const rows = flattenSchedule(response as never, weekStart)
    expect(rows[1].date.toISOString().slice(0, 10)).toBe("2026-08-10")
  })

  it("skips VIRTUAL placeholders with no shifts", () => {
    const rows = flattenSchedule(response as never, weekStart)
    expect(rows.every((r) => r.userId != null)).toBe(true)
  })

  it("stamps every row with the requested week start", () => {
    const rows = flattenSchedule(response as never, weekStart)
    expect(rows.every((r) => r.weekStart.getTime() === weekStart.getTime())).toBe(true)
  })
})

describe("bucketShiftHours", () => {
  const shift = (start: string, end: string) => ({
    startTime: parseHarriDateTime(start)!,
    endTime: parseHarriDateTime(end)!,
  })

  it("spreads a shift across the hours it actually covers", () => {
    const b = bucketShiftHours([shift("Aug 10, 2026 09:00", "Aug 10, 2026 12:00")])
    expect(b.get("2026-08-10")![9]).toBeCloseTo(1, 6)
    expect(b.get("2026-08-10")![10]).toBeCloseTo(1, 6)
    expect(b.get("2026-08-10")![11]).toBeCloseTo(1, 6)
    expect(b.get("2026-08-10")![12]).toBeCloseTo(0, 6)
  })

  it("credits a past-midnight shift to the NEXT day's early hours", () => {
    const b = bucketShiftHours([shift("Aug 10, 2026 23:00", "Aug 11, 2026 01:00")])
    expect(b.get("2026-08-10")![23]).toBeCloseTo(1, 6)
    expect(b.get("2026-08-11")![0]).toBeCloseTo(1, 6)
  })

  it("handles part-hours", () => {
    const b = bucketShiftHours([shift("Aug 10, 2026 09:30", "Aug 10, 2026 10:00")])
    expect(b.get("2026-08-10")![9]).toBeCloseTo(0.5, 6)
  })

  it("sums overlapping staff into headcount-hours", () => {
    const b = bucketShiftHours([
      shift("Aug 10, 2026 09:00", "Aug 10, 2026 10:00"),
      shift("Aug 10, 2026 09:00", "Aug 10, 2026 10:00"),
    ])
    expect(b.get("2026-08-10")![9]).toBeCloseTo(2, 6)
  })
})
