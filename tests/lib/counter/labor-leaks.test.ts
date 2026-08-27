// classifyAlertCode / leakLedger — the leak ledger's pure arithmetic,
// against "The leak ledger, over the window" table in
// .superpowers/sdd/2026-08-27-counter-labor-fidelity/task-2-brief.md,
// window 2026-08-20 … 2026-08-26, Hollywood.
//
// Every alert code's `alerts`, `hours` and `people` figure below is copied
// straight off that table — none of it is derived from this test's own
// expected `leakedHours`/`leakedCost`/`uncostableAlerts` answers. The three
// uncostable codes carry a null `timeDiffSec` for every row, exactly as the
// brief states ("The three uncostable codes carry a null timeDiffSec").
// `blendedRate` (20.42) is the brief's own quoted rate
// ($8,825 / 432.1 h), not back-solved from the $275 leak total.
//
// Row-level `timeDiffSec` values are not published — only each code's total
// hours is. Each costed code's total seconds (hours * 3600, rounded to the
// nearest second) is spread across that code's alert rows so the SUM an
// implementation recovers matches the brief's measured hours; the exact
// per-row split is invented and asserted nowhere. `userId`s are assigned
// round-robin over each code's measured `people` count so every id 0..people-1
// appears at least once and no more than that many distinct ids exist.
import { describe, it, expect, vi } from "vitest"

// `labor-leaks.ts` imports `@/lib/prisma` for `loadLeakLedger`. That import
// throws without `DATABASE_URL` at MODULE LOAD. This file never calls
// `loadLeakLedger` (loaders are not unit-tested, per this task's rule — no
// mocked Prisma) — the mock only keeps the import graph from crashing at
// load time, same pattern as `tests/lib/counter/labor-week.test.ts`.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { classifyAlertCode, leakLedger, type LeakRow } from "@/lib/counter/labor-leaks"

/* ── The measured window, 2026-08-20 … 2026-08-26, Hollywood ────────── */

const BLENDED_RATE = 20.42 // $8,825 / 432.1 h, from the brief's own text.

interface AlertRow {
  alertCode: string
  timeDiffSec: number | null
  userId: number
}

/** Spreads `hoursTotal` (measured, to 2 decimals) across `alerts` rows as
 *  whole seconds, remainder parked on the last row, so the rows' own sum
 *  reproduces the measured total. */
function costedRows(code: string, alerts: number, hoursTotal: number, people: number): AlertRow[] {
  const totalSec = Math.round(hoursTotal * 3600)
  const base = Math.floor(totalSec / alerts)
  const rows: AlertRow[] = []
  for (let i = 0; i < alerts; i += 1) {
    const sec = i === alerts - 1 ? totalSec - base * (alerts - 1) : base
    rows.push({ alertCode: code, timeDiffSec: sec, userId: i % people })
  }
  return rows
}

/** Uncostable codes: every row's `timeDiffSec` is null, per the brief. */
function uncostableRows(code: string, alerts: number, people: number): AlertRow[] {
  const rows: AlertRow[] = []
  for (let i = 0; i < alerts; i += 1) {
    rows.push({ alertCode: code, timeDiffSec: null, userId: i % people })
  }
  return rows
}

const MEASURED_ROWS: AlertRow[] = [
  ...costedRows("LATE_CLOCK_OUT", 28, 5.57, 13), // leak
  ...costedRows("EARLY_CLOCK_IN", 9, 7.9, 7), // leak
  ...costedRows("LATE_CLOCK_IN", 8, 4.92, 7), // saving
  ...costedRows("EARLY_CLOCK_OUT", 3, 6.55, 1), // saving
  ...uncostableRows("MISSED_CLOCK_OUT_OT_NOW", 28, 13),
  ...uncostableRows("MISSED_CLOCK_IN", 11, 8),
  ...uncostableRows("UNSCHEDULED_CLOCK_IN", 2, 2),
]

function rowFor(rows: LeakRow[], code: string): LeakRow {
  const row = rows.find((r) => r.code === code)
  if (!row) throw new Error(`no row for ${code}`)
  return row
}

describe("classifyAlertCode", () => {
  it("classifies LATE_CLOCK_OUT and EARLY_CLOCK_IN as leaks", () => {
    expect(classifyAlertCode("LATE_CLOCK_OUT")).toBe("leak")
    expect(classifyAlertCode("EARLY_CLOCK_IN")).toBe("leak")
  })

  // Explicit, per the brief: "the difference between a $275 leak and a $509
  // one" — these are NOT leaks, they are the store paying less than planned.
  it("classifies LATE_CLOCK_IN and EARLY_CLOCK_OUT as savings, not leaks", () => {
    expect(classifyAlertCode("LATE_CLOCK_IN")).toBe("saving")
    expect(classifyAlertCode("EARLY_CLOCK_OUT")).toBe("saving")
  })

  it("classifies every MISSED_* and UNSCHEDULED_* code as uncostable", () => {
    expect(classifyAlertCode("MISSED_CLOCK_OUT_OT_NOW")).toBe("uncostable")
    expect(classifyAlertCode("MISSED_CLOCK_IN")).toBe("uncostable")
    expect(classifyAlertCode("UNSCHEDULED_CLOCK_IN")).toBe("uncostable")
  })

  it("classifies an unknown code as uncostable, never as a leak", () => {
    expect(classifyAlertCode("SOMETHING_HARRI_ADDED_LATER")).toBe("uncostable")
  })
})

describe("leakLedger", () => {
  const ledger = leakLedger(MEASURED_ROWS, BLENDED_RATE)

  it("totals 13.47 leaked hours over the window", () => {
    expect(ledger.leakedHours).toBeCloseTo(13.47, 2)
  })

  it("totals $275 leaked cost over the window", () => {
    expect(Math.round(ledger.leakedCost)).toBe(275)
  })

  it("counts 41 uncostable alerts (28 + 11 + 2)", () => {
    expect(ledger.uncostableAlerts).toBe(41)
  })

  it("gives an uncostable row null hours and null cost, never 0", () => {
    const missed = rowFor(ledger.rows, "MISSED_CLOCK_IN")
    expect(missed.kind).toBe("uncostable")
    expect(missed.hours).toBeNull()
    expect(missed.cost).toBeNull()
    expect(missed.alerts).toBe(11)
    expect(missed.people).toBe(8)
  })

  it("does not fold saving hours into the leak total", () => {
    const lateIn = rowFor(ledger.rows, "LATE_CLOCK_IN")
    const earlyOut = rowFor(ledger.rows, "EARLY_CLOCK_OUT")
    expect(lateIn.kind).toBe("saving")
    expect(earlyOut.kind).toBe("saving")
    // Savings still carry a real hours/cost figure of their own — they are
    // just excluded from `leakedHours`/`leakedCost`.
    expect(lateIn.hours).toBeCloseTo(4.92, 2)
    expect(earlyOut.hours).toBeCloseTo(6.55, 2)
  })

  it("carries the measured alert and people counts on the leak rows", () => {
    const lateOut = rowFor(ledger.rows, "LATE_CLOCK_OUT")
    const earlyIn = rowFor(ledger.rows, "EARLY_CLOCK_IN")
    expect(lateOut.alerts).toBe(28)
    expect(lateOut.people).toBe(13)
    expect(lateOut.hours).toBeCloseTo(5.57, 2)
    expect(earlyIn.alerts).toBe(9)
    expect(earlyIn.people).toBe(7)
    expect(earlyIn.hours).toBeCloseTo(7.9, 2)
  })
})
