import { describe, it, expect } from "vitest"
import {
  firstNameOf,
  greetingFor,
  storeLocalHour,
} from "@/app/dashboard/components/greeting-masthead"
import { formatBandCaption } from "@/app/dashboard/components/hero-kpi"

describe("greetingFor", () => {
  it("says morning before noon", () => {
    expect(greetingFor(0)).toBe("Good morning")
    expect(greetingFor(6)).toBe("Good morning")
    expect(greetingFor(11)).toBe("Good morning")
  })

  it("says afternoon from noon to 5pm", () => {
    expect(greetingFor(12)).toBe("Good afternoon")
    expect(greetingFor(16)).toBe("Good afternoon")
  })

  it("says evening from 5pm", () => {
    expect(greetingFor(17)).toBe("Good evening")
    expect(greetingFor(23)).toBe("Good evening")
  })
})

describe("storeLocalHour", () => {
  // The whole point of this helper: the answer must come from the store's
  // clock, not the server's. These assertions fail if it ever falls back to
  // getHours(), regardless of what TZ the test runner is in.
  it("reads the hour in Los Angeles, not UTC", () => {
    // 2026-08-20T04:30:00Z is 21:30 the previous day in PDT.
    expect(storeLocalHour(new Date("2026-08-20T04:30:00Z"))).toBe(21)
  })

  it("puts a UTC morning in the LA small hours", () => {
    // 09:00Z is 02:00 PDT — still "morning" locally, but a different date.
    expect(storeLocalHour(new Date("2026-08-20T09:00:00Z"))).toBe(2)
  })

  it("respects standard time in winter", () => {
    // 2026-01-15T04:30:00Z is 20:30 PST the previous day (UTC-8, not -7).
    expect(storeLocalHour(new Date("2026-01-15T04:30:00Z"))).toBe(20)
  })

  it("greets by the store clock across the date line", () => {
    // Server-local logic in UTC would call this 04:30 and say "good morning".
    expect(greetingFor(storeLocalHour(new Date("2026-08-20T04:30:00Z")))).toBe(
      "Good evening"
    )
  })
})

describe("firstNameOf", () => {
  it("takes the first word", () => {
    expect(firstNameOf("Chris Karimian")).toBe("Chris")
  })

  it("handles a single name", () => {
    expect(firstNameOf("Chris")).toBe("Chris")
  })

  it("trims surrounding and repeated whitespace", () => {
    expect(firstNameOf("  Chris   Karimian ")).toBe("Chris")
  })

  it("returns null when there is no name to greet", () => {
    expect(firstNameOf(null)).toBeNull()
    expect(firstNameOf(undefined)).toBeNull()
    expect(firstNameOf("")).toBeNull()
    expect(firstNameOf("   ")).toBeNull()
  })
})

describe("formatBandCaption", () => {
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`

  it("spans min to max of the baseline weeks", () => {
    expect(formatBandCaption([5940, 4320, 5100, 4880], money)).toBe(
      "band $4,320–$5,940"
    )
  })

  it("ignores empty baseline weeks rather than flooring the band at zero", () => {
    expect(formatBandCaption([0, 4320, 5940], money)).toBe("band $4,320–$5,940")
  })

  it("returns nothing when fewer than two weeks have data", () => {
    expect(formatBandCaption([5000], money)).toBe("")
    expect(formatBandCaption([0, 0, 5000], money)).toBe("")
    expect(formatBandCaption([], money)).toBe("")
  })
})
