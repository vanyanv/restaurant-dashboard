import { describe, expect, it } from "vitest"
import { buildLaborClock, buildLaborHours, buildLaborPeople, crewName, type LaborCrew } from "@/lib/counter/labor-crew"

const crew: LaborCrew = {
  stores: [
    { id: "h", name: "Hollywood" },
    { id: "v", name: "Van Nuys" },
  ],
  shifts: [
    // Ana: 42 h in one week at Hollywood (6 shifts of 7 h).
    ...Array.from({ length: 6 }, () => ({ storeId: "h", userId: 1, minutes: 420, weekStart: "2026-11-09" })),
    // Ben: 16 h across two weeks and two stores.
    { storeId: "h", userId: 2, minutes: 480, weekStart: "2026-11-09" },
    { storeId: "v", userId: 2, minutes: 480, weekStart: "2026-11-16" },
    // Not in the crew list.
    { storeId: "v", userId: 3, minutes: 450, weekStart: "2026-11-09" },
  ],
  alerts: [
    { storeId: "v", userId: 2, alertCode: "MISSED_CLOCK_OUT_OT_NOW" },
    { storeId: "v", userId: 2, alertCode: "MISSED_CLOCK_IN" },
    { storeId: "v", userId: 2, alertCode: "LATE_CLOCK_IN" },
    { storeId: "h", userId: 1, alertCode: "EARLY_CLOCK_IN" },
    // Flagged, never scheduled.
    { storeId: "h", userId: 4, alertCode: "MISSED_CLOCK_OUT" },
  ],
  names: [
    { userId: 1, firstName: "Ana", lastName: "garcia" },
    { userId: 2, firstName: "Ben", lastName: null },
    { userId: 4, firstName: " ", lastName: "Solo" },
  ],
}

describe("crewName", () => {
  it("is the first name and the last initial, or nothing without a first name", () => {
    expect(crewName({ userId: 1, firstName: "Ana", lastName: "garcia" })).toBe("Ana G.")
    expect(crewName({ userId: 2, firstName: "Ben", lastName: null })).toBe("Ben")
    expect(crewName({ userId: 4, firstName: " ", lastName: "Solo" })).toBeNull()
    expect(crewName(undefined)).toBeNull()
  })
})

describe("buildLaborPeople", () => {
  const view = buildLaborPeople(crew)!

  it("puts the person past 40 hours first, then missed punches", () => {
    expect(view.rows.map((r) => r.name)).toEqual(["Ana G.", "Ben", "Not in the crew list", "Not in the crew list"])
    expect(view.rows[0]).toMatchObject({ hours: "42 h", shifts: "6 shifts", over: "42 h the week of Nov 9", records: "", fill: 100 })
  })

  it("does not flag 40 hours spread over two weeks, and counts punches per person", () => {
    const ben = view.rows[1]
    expect(ben).toMatchObject({ hours: "16 h", over: null, store: "Hollywood, Van Nuys" })
    expect(ben.records).toBe("2 missed punches · 1 late clock-in")
  })

  it("lists someone flagged but not scheduled without inventing hours", () => {
    const solo = view.rows.find((r) => r.key === "4")!
    expect(solo).toMatchObject({ hours: "none", shifts: "not on the schedule", records: "1 missed punch", fill: 0 })
  })

  it("says what it counted, in words", () => {
    expect(view.sentence).toBe(
      "3 people are on the published schedule for 66 hours. 1 person is scheduled past 40 hours in one week. 2 people have a missed punch flagged.",
    )
    expect(view.note).toContain("2 people are not in the crew list yet")
    expect(view.note).toContain("not by person")
  })

  it("is nothing when there is nobody", () => {
    expect(buildLaborPeople({ ...crew, shifts: [], alerts: [] })).toBeNull()
  })
})

describe("buildLaborClock", () => {
  it("counts missed punches by store, most first, and never the early or late ones", () => {
    const c = buildLaborClock(crew)
    expect(c.stores.map((s) => [s.name, s.value])).toEqual([["Van Nuys", "2"], ["Hollywood", "1"]])
    expect(c.stores[0].detail).toBe("1 missed clock-out · 1 missed clock-in · 1 person")
    expect(c.stores[0].fill).toBe(100)
    expect(c.sentence).toBe("3 missed punches were flagged on these days, most at Van Nuys (2).")
  })

  it("names a store with none, and says so when there are none at all", () => {
    const c = buildLaborClock({ ...crew, alerts: [] })
    expect(c.stores.every((s) => s.detail === "none flagged" && s.fill === 0)).toBe(true)
    expect(c.sentence).toBe("No missed punches were flagged on these days.")
  })
})

describe("buildLaborHours", () => {
  it("draws people per hour against the busiest hour and tags the tightest", () => {
    const h = buildLaborHours(
      {
        hours: [
          { hour: 11, scheduled: 2, demand: 10.4 },
          { hour: 12, scheduled: 4, demand: 31.6 },
          { hour: 0, scheduled: 1, demand: null },
        ],
        tightest: 12,
        sentence: "Noon is the tightest hour.",
      },
      "Sat, Nov 21",
    )
    expect(h.rows.map((r) => [r.title, r.value, r.detail, r.fill, r.tight])).toEqual([
      ["11 AM", "2 people", "10 orders forecast", 50, false],
      ["12 PM", "4 people", "32 orders forecast", 100, true],
      ["12 AM", "1 person", "no forecast", 25, false],
    ])
    expect(h.sentence).toBe("Noon is the tightest hour.")
  })
})
