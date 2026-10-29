import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { acceptingDay, dueAtFor, laInstant, lateMinutes, windowPhase, windowSummary, type CheckWindow } from "@/lib/checks/time"
import { cellStatus, onTimeRate } from "@/lib/checks/status"
import { harriIsActive, isWeakPin, newCheckCode, pickPin, slugify } from "@/lib/checks/setup"
import { issueCrewPass, readCrewPass } from "@/lib/checks/crew-session"

/**
 * Store checks: the one status rule every screen reads, the LA clock it is
 * measured on, the PIN rules, and the crew pass. Windows are LA wall-clock
 * minutes; an evening window may run past 1440 and still belongs to the day
 * it opened.
 */
const MORNING: CheckWindow = { opensAtMin: 6 * 60, dueAtMin: 10 * 60, graceMin: 30 }
const EVENING: CheckWindow = { opensAtMin: 21 * 60, dueAtMin: 24 * 60 + 30, graceMin: 30 }

describe("laInstant", () => {
  it("reads LA wall-clock on both sides of DST", () => {
    // PDT (UTC-7) in October, PST (UTC-8) in December.
    expect(laInstant("2026-10-25", 600).toISOString()).toBe("2026-10-25T17:00:00.000Z")
    expect(laInstant("2026-12-01", 600).toISOString()).toBe("2026-12-01T18:00:00.000Z")
  })

  it("runs past midnight into the next calendar day", () => {
    expect(laInstant("2026-10-25", 24 * 60 + 30).toISOString()).toBe("2026-10-26T07:30:00.000Z")
  })
})

describe("windowPhase and lateMinutes", () => {
  const at = (iso: string) => new Date(iso)
  it("moves upcoming -> open -> late -> closed", () => {
    expect(windowPhase("2026-10-25", MORNING, at("2026-10-25T12:59:00Z"))).toBe("upcoming")
    expect(windowPhase("2026-10-25", MORNING, at("2026-10-25T13:00:00Z"))).toBe("open")
    expect(windowPhase("2026-10-25", MORNING, at("2026-10-25T17:00:00Z"))).toBe("open")
    expect(windowPhase("2026-10-25", MORNING, at("2026-10-25T17:10:00Z"))).toBe("late")
    expect(windowPhase("2026-10-25", MORNING, at("2026-10-25T17:31:00Z"))).toBe("closed")
  })

  it("rounds lateness up to the minute", () => {
    expect(lateMinutes("2026-10-25", MORNING, at("2026-10-25T17:00:00Z"))).toBe(0)
    expect(lateMinutes("2026-10-25", MORNING, at("2026-10-25T17:00:20Z"))).toBe(1)
    expect(lateMinutes("2026-10-25", MORNING, at("2026-10-25T17:12:00Z"))).toBe(12)
  })
})

describe("acceptingDay", () => {
  it("gives an after-midnight evening check to the day it opened", () => {
    // 00:10 LA on the 26th: the 25th's evening window is still open.
    expect(acceptingDay(EVENING, new Date("2026-10-26T07:10:00Z"))).toBe("2026-10-25")
  })
  it("is null outside every window", () => {
    expect(acceptingDay(MORNING, new Date("2026-10-25T20:00:00Z"))).toBeNull()
  })
})

describe("due time by weekday", () => {
  // Closes 1 am most nights and 2 am Friday, Saturday and Sunday nights.
  const ONE = 24 * 60 + 60
  const TWO = 24 * 60 + 120
  const LATE_WEEKEND: CheckWindow = {
    opensAtMin: 21 * 60,
    dueAtMin: ONE,
    graceMin: 30,
    dueByWeekday: [TWO, ONE, ONE, ONE, ONE, TWO, TWO],
  }

  it("uses the night the window opens on", () => {
    expect(dueAtFor("2026-10-22", LATE_WEEKEND)).toBe(ONE) // Thursday
    expect(dueAtFor("2026-10-23", LATE_WEEKEND)).toBe(TWO) // Friday
    expect(dueAtFor("2026-10-25", LATE_WEEKEND)).toBe(TWO) // Sunday
    expect(dueAtFor("2026-10-26", LATE_WEEKEND)).toBe(ONE) // Monday
    expect(dueAtFor("2026-10-23", EVENING)).toBe(EVENING.dueAtMin)
  })

  it("is on time at 1:45 am on a Friday night, late on a Thursday", () => {
    // 1:45 am PDT is 08:45Z the next calendar day.
    expect(lateMinutes("2026-10-23", LATE_WEEKEND, new Date("2026-10-24T08:45:00Z"))).toBe(0)
    expect(lateMinutes("2026-10-22", LATE_WEEKEND, new Date("2026-10-23T08:45:00Z"))).toBe(45)
    expect(windowPhase("2026-10-23", LATE_WEEKEND, new Date("2026-10-24T08:45:00Z"))).toBe("open")
    expect(windowPhase("2026-10-22", LATE_WEEKEND, new Date("2026-10-23T08:45:00Z"))).toBe("closed")
  })

  it("keeps a Friday-night check open for the day it started past 2 am", () => {
    expect(acceptingDay(LATE_WEEKEND, new Date("2026-10-24T09:20:00Z"))).toBe("2026-10-23")
  })

  it("opens after midnight and still belongs to the night before", () => {
    // Van Nuys: opens 12:30 am, due 2:00 am, 3:00 am Fri-Sun nights.
    const AFTER_MIDNIGHT: CheckWindow = {
      opensAtMin: 24 * 60 + 30,
      dueAtMin: 24 * 60 + 120,
      graceMin: 30,
      dueByWeekday: [1620, 1560, 1560, 1560, 1560, 1620, 1620],
    }
    // Monday 2026-10-26 night: 12:45 am Tuesday PDT is 07:45Z Tuesday.
    expect(acceptingDay(AFTER_MIDNIGHT, new Date("2026-10-27T07:45:00Z"))).toBe("2026-10-26")
    // Monday evening at 11 pm, nothing is open yet.
    expect(acceptingDay(AFTER_MIDNIGHT, new Date("2026-10-27T06:00:00Z"))).toBeNull()
    // Friday 2026-10-23 night at 2:40 am Saturday is still on time.
    expect(lateMinutes("2026-10-23", AFTER_MIDNIGHT, new Date("2026-10-24T09:40:00Z"))).toBe(0)
  })

  it("says which nights differ", () => {
    expect(windowSummary(LATE_WEEKEND)).toBe("9:00 pm – 1:00 am · 2:00 am Fri, Sat, Sun")
    expect(windowSummary(EVENING)).toBe("9:00 pm – 12:30 am")
  })
})

describe("cellStatus", () => {
  const base = { day: "2026-10-25", window: MORNING, enabled: true, closed: false, submission: null }
  const noon = new Date("2026-10-25T19:00:00Z")
  it("is missed after the grace period with no submission", () => {
    expect(cellStatus({ ...base, now: noon })).toBe("missed")
  })
  it("prefers a submission over everything", () => {
    expect(cellStatus({ ...base, closed: true, submission: { lateMinutes: 0 }, now: noon })).toBe("on_time")
    expect(cellStatus({ ...base, submission: { lateMinutes: 5 }, now: noon })).toBe("late")
  })
  it("lets a closed store and a switched-off check excuse a miss", () => {
    expect(cellStatus({ ...base, closed: true, now: noon })).toBe("closed")
    expect(cellStatus({ ...base, enabled: false, now: noon })).toBe("off")
  })
  it("never calls a window missed that closed before checks were set up", () => {
    const since = new Date("2026-10-25T22:00:00Z") // 3 pm LA
    expect(cellStatus({ ...base, now: noon, since })).toBe("before")
    expect(cellStatus({ ...base, day: "2026-10-26", now: new Date("2026-10-26T19:00:00Z"), since })).toBe("missed")
  })
  it("counts only on-time, late and missed toward the rate", () => {
    expect(onTimeRate(["on_time", "late", "missed", "closed", "off", "open"])).toBe(33)
    expect(onTimeRate(["closed", "upcoming", "before"])).toBeNull()
  })
})

describe("PINs and codes", () => {
  it("rejects repeats and runs", () => {
    for (const p of ["0000", "7777", "1234", "6789", "4321", "9876"]) expect(isWeakPin(p)).toBe(true)
    for (const p of ["1357", "0420", "8812"]) expect(isWeakPin(p)).toBe(false)
  })
  it("never hands out a PIN already taken at the store", () => {
    const taken = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const pin = pickPin(taken)
      expect(pin).toMatch(/^\d{4}$/)
      expect(taken.has(pin)).toBe(false)
      expect(isWeakPin(pin)).toBe(false)
      taken.add(pin)
    }
  })
  it("builds a store code from the name plus a random tail", () => {
    expect(slugify("Chris N Eddy's — Van Nuys")).toMatch(/^[a-z0-9-]+$/)
    expect(newCheckCode("Van Nuys")).toMatch(/^van-nuys-[a-z0-9]+$/)
  })
  it("reads Harri's inactive statuses as gone", () => {
    expect(harriIsActive("Active")).toBe(true)
    expect(harriIsActive(null)).toBe(true)
    expect(harriIsActive("Terminated")).toBe(false)
  })
})

describe("crew pass", () => {
  beforeEach(() => vi.stubEnv("CHECKS_SECRET", "test-secret"))
  afterEach(() => vi.unstubAllEnvs())
  const pass = { storeId: "s1", crewMemberId: "c1", kind: "MORNING" as const, day: "2026-10-25" }
  it("round-trips, and expires", () => {
    const now = Date.now()
    const token = issueCrewPass(pass, now)
    expect(readCrewPass(token, now)).toMatchObject(pass)
    expect(readCrewPass(token, now + 11 * 60 * 60 * 1000)).toBeNull()
  })
  it("refuses a tampered pass", () => {
    const token = issueCrewPass(pass)
    const [body, sig] = token.split(".")
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), storeId: "s2" })).toString("base64url")
    expect(readCrewPass(`${forged}.${sig}`)).toBeNull()
    expect(readCrewPass("garbage")).toBeNull()
  })
})

describe("PIN email", () => {
  it("posts a bilingual message to Resend, and reports a refusal", async () => {
    const { sendPinEmail } = await import("@/lib/checks/email")
    vi.stubEnv("RESEND_API_KEY", "re_test")
    vi.stubEnv("CHECKS_EMAIL_FROM", "Checks <checks@example.com>")
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const e = { to: "maria@example.com", firstName: "Maria", storeName: "Van Nuys", pin: "8163", link: "https://x/checks/van-nuys-abc123" }
    expect(await sendPinEmail(e)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    const sent = JSON.parse(init.body)
    expect(sent.to).toEqual(["maria@example.com"])
    expect(sent.text).toContain("8163")
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }))
    expect((await sendPinEmail(e)).ok).toBe(false)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
