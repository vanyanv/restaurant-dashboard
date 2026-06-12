// Pins the timezone semantics of the shared date helpers that replace ~20
// per-file copies. The UTC/local distinction is the whole point: forecast
// rows use @db.Date (UTC midnight), so UTC helpers must not drift when the
// process runs in a non-UTC zone (local dev in PDT vs Vercel's UTC).
//
// TZ is forced to America/Los_Angeles before any Date use so the UTC-vs-local
// assertions actually diverge.

process.env.TZ = "America/Los_Angeles"

import { describe, it, expect } from "vitest"
import { ymdUTC, startOfDayUTC, startOfDayLocal } from "@/lib/date-utils"

describe("ymdUTC", () => {
  it("formats the UTC calendar date as YYYY-MM-DD", () => {
    expect(ymdUTC(new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12")
  })

  it("uses the UTC day even when local time is still the previous day", () => {
    // 03:00Z on June 12 is 20:00 June 11 in LA — must still say June 12.
    expect(ymdUTC(new Date("2026-06-12T03:00:00Z"))).toBe("2026-06-12")
  })
})

describe("startOfDayUTC", () => {
  it("floors to UTC midnight", () => {
    const out = startOfDayUTC(new Date("2026-06-12T15:30:45.123Z"))
    expect(out.toISOString()).toBe("2026-06-12T00:00:00.000Z")
  })

  it("does not mutate its input", () => {
    const input = new Date("2026-06-12T15:30:45.123Z")
    startOfDayUTC(input)
    expect(input.toISOString()).toBe("2026-06-12T15:30:45.123Z")
  })

  it("stays on the UTC day when the local day differs", () => {
    // 03:00Z June 12 = June 11 evening in LA; UTC floor is June 12 00:00Z.
    const out = startOfDayUTC(new Date("2026-06-12T03:00:00Z"))
    expect(out.toISOString()).toBe("2026-06-12T00:00:00.000Z")
  })
})

describe("startOfDayLocal", () => {
  it("floors to local (process TZ) midnight, which differs from the UTC floor", () => {
    const input = new Date("2026-06-12T03:00:00Z") // June 11, 20:00 PDT
    const out = startOfDayLocal(input)
    // Local midnight of June 11 PDT = 2026-06-11T07:00:00Z
    expect(out.toISOString()).toBe("2026-06-11T07:00:00.000Z")
    expect(out.toISOString()).not.toBe(startOfDayUTC(input).toISOString())
  })

  it("does not mutate its input", () => {
    const input = new Date("2026-06-12T03:00:00Z")
    startOfDayLocal(input)
    expect(input.toISOString()).toBe("2026-06-12T03:00:00.000Z")
  })
})
