import { describe, expect, it } from "vitest"
import { DEFAULT_TEMPLATES } from "@/lib/checks/defaults"
import { cellStatus } from "@/lib/checks/status"
import { acceptingDay, isThanksgiving, offOn, visibleDay, windowBounds, windowPhase, type CheckWindow } from "@/lib/checks/time"

/**
 * Thanksgiving (owner 2026-11-26): every store runs only the Night check,
 * open from 9:00 am and closing itself at 6:00 pm. 2026-11-26 is Thanksgiving
 * (PST, LA = UTC-8); 2026-11-25 is the Wednesday before.
 */
const tpl = (kind: "MORNING" | "EVENING"): CheckWindow => {
  const t = DEFAULT_TEMPLATES.find((x) => x.kind === kind)!
  return { ...t, dueByWeekday: [...t.dueByWeekday] }
}
const MORNING = tpl("MORNING")
const NIGHT = tpl("EVENING")
const utc = (s: string) => new Date(s)

describe("isThanksgiving", () => {
  it("is the fourth Thursday of November", () => {
    expect(isThanksgiving("2026-11-26")).toBe(true)
    expect(isThanksgiving("2027-11-25")).toBe(true)
    expect(isThanksgiving("2028-11-23")).toBe(true)
    expect(isThanksgiving("2026-11-19")).toBe(false)
    expect(isThanksgiving("2026-11-27")).toBe(false)
    expect(isThanksgiving("2026-10-22")).toBe(false)
  })
})

describe("Thanksgiving hours", () => {
  it("Night opens at 9:00 am with Submit open, and closes at 6:00 pm", () => {
    const b = windowBounds("2026-11-26", NIGHT)
    expect(b.opens.toISOString()).toBe("2026-11-26T17:00:00.000Z")
    expect(b.submitFrom.toISOString()).toBe("2026-11-26T17:00:00.000Z")
    expect(b.due.toISOString()).toBe("2026-11-27T02:00:00.000Z")
    expect(windowPhase("2026-11-26", NIGHT, utc("2026-11-26T18:00:00Z"))).toBe("open")
    expect(acceptingDay(NIGHT, utc("2026-11-26T18:00:00Z"))).toBe("2026-11-26")
    expect(windowPhase("2026-11-26", NIGHT, utc("2026-11-27T02:01:00Z"))).toBe("closed")
  })

  it("the night before and after keep their usual hours", () => {
    expect(windowBounds("2026-11-25", NIGHT).due.toISOString()).toBe("2026-11-26T10:00:00.000Z")
    expect(windowBounds("2026-11-27", NIGHT).opens.toISOString()).toBe("2026-11-28T01:30:00.000Z")
    // Wednesday night is still taking submissions at 1:30 am Thursday.
    expect(acceptingDay(NIGHT, utc("2026-11-26T09:30:00Z"))).toBe("2026-11-25")
  })

  it("Morning is off: crew don't see it and it is never missed", () => {
    expect(offOn("2026-11-26", MORNING)).toBe(true)
    expect(offOn("2026-11-27", MORNING)).toBe(false)
    expect(visibleDay(MORNING, utc("2026-11-26T20:00:00Z"))).toBeNull()
    expect(acceptingDay(MORNING, utc("2026-11-27T01:00:00Z"))).toBeNull()
    const status = cellStatus({
      day: "2026-11-26", window: MORNING, enabled: true, closed: false, submission: null,
      now: utc("2026-11-27T05:00:00Z"),
    })
    expect(status).toBe("off")
  })

  it("a check with no Thanksgiving hours keeps its usual window", () => {
    const usual = { ...NIGHT, thanksgivingOpensMin: null, thanksgivingDueMin: null }
    expect(windowBounds("2026-11-26", usual).opens.toISOString()).toBe("2026-11-27T01:30:00.000Z")
  })
})
