import { windowBounds, windowPhase, type CheckWindow } from "./time"

/**
 * What one store's one check was on one business day. The single function
 * that decides it — Today, History, the crew page and the missed-check alerts
 * all call this, so no two screens can disagree about whether a check was
 * missed.
 *
 *   on_time   every task done, by the due time
 *   late      every task done, the last one inside the grace period
 *   partial   the check closed itself with some tasks done and some missed
 *   missed    the window ended with no task done (or, before checks closed
 *             themselves, with nothing submitted)
 *   closed    the owner marked the store closed that day
 *   open      crew can work on it now: ticking before Submit unlocks, or
 *             taking submissions (past due counts while grace lasts)
 *   upcoming  not open yet
 *   off       the owner switched this check off
 *   before    the window closed before checks were set up for the store
 *   paused    the window closes inside a pause (the owner is training crew):
 *             practice only, never on time, late or missed
 */
export type CellStatus =
  | "on_time"
  | "late"
  | "partial"
  | "missed"
  | "closed"
  | "open"
  | "upcoming"
  | "off"
  | "before"
  | "paused"

export type CellInput = {
  day: string
  window: CheckWindow
  enabled: boolean
  closed: boolean
  /**
   * The check's record, sent by crew or closed by the app. `done` and
   * `total` count its tasks; a row without them (crew submits always had
   * every task done) counts as complete.
   */
  submission: { lateMinutes: number; done?: number; total?: number } | null
  now: Date
  /**
   * When this check was set up for the store. A window that had already
   * closed by then is "before": nobody could have done it, so it is never a
   * miss and never an alert.
   */
  since?: Date
  /**
   * The store's check pauses. A window that closes inside one is "paused",
   * even with a submission: work done while the owner was training crew is
   * practice and counts for nothing.
   */
  pauses?: PauseSpan[]
}

/** One pause of a store's checks. `resumedAt` null is a pause still on. */
export type PauseSpan = { pausedAt: Date; resumedAt: Date | null }

/** Whether this check's window closes inside a pause. */
export function windowPaused(day: string, window: CheckWindow, pauses: PauseSpan[] | undefined): boolean {
  if (!pauses || pauses.length === 0) return false
  const closes = windowBounds(day, window).closes.getTime()
  return pauses.some(
    (p) => p.pausedAt.getTime() <= closes && (p.resumedAt === null || closes < p.resumedAt.getTime()),
  )
}

export function cellStatus(input: CellInput): CellStatus {
  if (windowPaused(input.day, input.window, input.pauses)) return "paused"
  if (input.submission) {
    const { done, total, lateMinutes } = input.submission
    if (total !== undefined && done !== undefined && done < total) return done === 0 ? "missed" : "partial"
    return lateMinutes > 0 ? "late" : "on_time"
  }
  if (input.closed) return "closed"
  if (!input.enabled) return "off"
  if (input.since && windowBounds(input.day, input.window).closes.getTime() < input.since.getTime()) return "before"
  const phase = windowPhase(input.day, input.window, input.now)
  if (phase === "upcoming") return "upcoming"
  if (phase === "closed") return "missed"
  return "open"
}

/** Whether a status counts toward the on-time rate, and how. */
export function countsToward(status: CellStatus): "on_time" | "not_on_time" | null {
  if (status === "on_time") return "on_time"
  if (status === "late" || status === "partial" || status === "missed") return "not_on_time"
  return null
}

/** On-time share as a whole percent, or null when nothing was due. */
export function onTimeRate(statuses: CellStatus[]): number | null {
  let due = 0
  let ok = 0
  for (const s of statuses) {
    const c = countsToward(s)
    if (c === null) continue
    due += 1
    if (c === "on_time") ok += 1
  }
  return due === 0 ? null : Math.round((ok / due) * 100)
}
