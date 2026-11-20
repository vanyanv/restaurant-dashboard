/**
 * Missed clock-ins and clock-outs: the time records Harri says are wrong.
 *
 * A missed punch is a shift with no clock-in or no clock-out. Until a manager
 * fixes it in Harri, that shift's hours (and so its labor cost) are wrong, so
 * any labor figure over it is provisional. These are the ONE functions that
 * count and word them, read by the Labor page (off its leak ledger) and by
 * Needs you (off `loadTimeRecordsNeed` in `labor-leaks.ts`), so the two can
 * never print different counts for the same week.
 *
 * Pure, with no Prisma import, so `labor-plain.ts` and `overview-plain.ts`
 * can read it without dragging the database into their tests.
 */

export const MISSED_CLOCK_IN_CODES = new Set<string>(["MISSED_CLOCK_IN"])
export const MISSED_CLOCK_OUT_CODES = new Set<string>(["MISSED_CLOCK_OUT_OT_NOW", "MISSED_CLOCK_OUT"])

export interface MissedPunches {
  missedIn: number
  missedOut: number
}

/**
 * Missed clock-ins and clock-outs, counted off alert rows. Takes either ledger
 * rows (`code` + `alerts`) or raw alert rows (`alertCode`, one each).
 */
export function missedPunches(
  rows: ReadonlyArray<{ code: string; alerts: number } | { alertCode: string }>,
): MissedPunches {
  let missedIn = 0
  let missedOut = 0
  for (const r of rows) {
    const code = "code" in r ? r.code : r.alertCode
    const n = "alerts" in r ? r.alerts : 1
    if (MISSED_CLOCK_IN_CODES.has(code)) missedIn += n
    else if (MISSED_CLOCK_OUT_CODES.has(code)) missedOut += n
  }
  return { missedIn, missedOut }
}

/** "13 missed clock-ins, 3 missed clock-outs". A zero side is left out. */
export function missedPunchesText(m: MissedPunches): string {
  const parts: string[] = []
  if (m.missedIn > 0) parts.push(`${m.missedIn} missed clock-${m.missedIn === 1 ? "in" : "ins"}`)
  if (m.missedOut > 0) parts.push(`${m.missedOut} missed clock-${m.missedOut === 1 ? "out" : "outs"}`)
  return parts.join(", ")
}

/** The headline when there are missed punches; null when there are none. */
export function timeRecordsHeadline(m: MissedPunches): string | null {
  return m.missedIn + m.missedOut > 0 ? `Time records need fixing: ${missedPunchesText(m)}` : null
}

/** How far back Needs you looks for missed punches: the week a manager can still fix before payroll. */
export const TIME_RECORDS_DAYS = 7

export interface TimeRecordsNeed extends MissedPunches {
  /** Store names with at least one missed punch, most first. */
  stores: string[]
  /** The window's first and last day, `YYYY-MM-DD`. */
  from: string
  to: string
}

/**
 * Missed punches for Needs you, folded off raw rows. `null` when there are
 * none, so a caller adds no group at all rather than a group of nothing.
 */
export function timeRecordsNeed(
  rows: ReadonlyArray<{ alertCode: string; storeName: string }>,
  from: string,
  to: string,
): TimeRecordsNeed | null {
  const m = missedPunches(rows)
  if (m.missedIn + m.missedOut === 0) return null
  const byStore = new Map<string, number>()
  for (const r of rows) {
    if (!MISSED_CLOCK_IN_CODES.has(r.alertCode) && !MISSED_CLOCK_OUT_CODES.has(r.alertCode)) continue
    byStore.set(r.storeName, (byStore.get(r.storeName) ?? 0) + 1)
  }
  const stores = [...byStore].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  return { ...m, stores, from, to }
}

/**
 * The "Time records" group Needs you shows, in words. Harri does not tell us
 * when a punch is fixed, so the copy says "flagged", never "still open".
 */
export function timeRecordsGroup(t: TimeRecordsNeed): {
  what: string
  why: string
  action: { label: string; href: string }
} {
  const where = t.stores.length === 0 ? "" : ` at ${t.stores.length <= 2 ? t.stores.join(" and ") : `${t.stores.slice(0, 2).join(", ")} and ${t.stores.length - 2} more`}`
  return {
    what: `Time records need fixing: ${missedPunchesText(t)}`,
    why:
      `Harri flagged these in the last ${TIME_RECORDS_DAYS} days${where}. Until a manager fixes them in Harri, ` +
      "those shifts carry the wrong hours and labor reads wrong. Harri does not tell us when one is fixed.",
    action: { label: "Open labor", href: "/dashboard/labor" },
  }
}
