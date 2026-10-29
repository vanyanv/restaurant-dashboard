import { windowBounds, windowPhase, type CheckWindow } from "./time"

/**
 * What one store's one check was on one business day. The single function
 * that decides it — Today, History, the crew page and the missed-check alerts
 * all call this, so no two screens can disagree about whether a check was
 * missed.
 *
 *   on_time   submitted by the due time
 *   late      submitted inside the grace period
 *   missed    the grace period ended with nothing submitted
 *   closed    the owner marked the store closed that day
 *   open      crew can work on it now: ticking before Submit unlocks, or
 *             taking submissions (past due counts while grace lasts)
 *   upcoming  not open yet
 *   off       the owner switched this check off
 *   before    the window closed before checks were set up for the store
 */
export type CellStatus = "on_time" | "late" | "missed" | "closed" | "open" | "upcoming" | "off" | "before"

export type CellInput = {
  day: string
  window: CheckWindow
  enabled: boolean
  closed: boolean
  submission: { lateMinutes: number } | null
  now: Date
  /**
   * When this check was set up for the store. A window that had already
   * closed by then is "before": nobody could have done it, so it is never a
   * miss and never an alert.
   */
  since?: Date
}

export function cellStatus(input: CellInput): CellStatus {
  if (input.submission) return input.submission.lateMinutes > 0 ? "late" : "on_time"
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
  if (status === "late" || status === "missed") return "not_on_time"
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
