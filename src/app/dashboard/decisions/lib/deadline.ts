/**
 * When an action stops being worth taking.
 *
 * The card used to render `today + 7` for every opportunity, so five cards of
 * five different kinds all showed the same date. The horizon each generator
 * actually computed its impact over is the honest source: a 1-day horizon means
 * the value bleeds away daily, a 30-day horizon is a play rather than a
 * deadline, and everything between gets a real date at the end of its window.
 */
export type DecisionDeadline =
  /** Value bleeds every day this isn't taken. No date to hide behind. */
  | { kind: "decays" }
  /** Act by this date — the end of the window the impact was computed over. */
  | { kind: "date"; date: string; daysLeft: number }
  /** A long play, measured in weeks. A date would imply false urgency. */
  | { kind: "horizon"; days: number }

/** Horizons at or above this are plays, not deadlines. */
const HORIZON_PLAY_DAYS = 30

export function deadlineFor(
  horizonDays: number | null | undefined,
  todayKey: string,
): DecisionDeadline {
  const days = horizonDays ?? 7
  if (days <= 1) return { kind: "decays" }
  if (days >= HORIZON_PLAY_DAYS) return { kind: "horizon", days }

  const d = new Date(`${todayKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return { kind: "date", date: d.toISOString().slice(0, 10), daysLeft: days }
}
