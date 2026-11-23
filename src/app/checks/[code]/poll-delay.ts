import type { CrewView } from "@/lib/checks/crew"

/**
 * How long the crew page waits before asking the server whether the check
 * changed. Every ask is a server call billed as Vercel active CPU, and a
 * phone or tablet left on this page used to ask every 20 s all day.
 *
 * - On the list: every 30 s. Your own ticks show the moment you tap; this
 *   only brings in a second person's ticks or a window locking.
 * - Anywhere else: right when the next thing on the clock happens (a window
 *   opening, Submit unlocking, the due time, the window closing), and at
 *   least every 5 minutes in case the owner changes a list or pauses checks.
 * - Nothing on the clock for the rest of the day: every 15 minutes.
 */
export const LIST_POLL_MS = 30_000
export const IDLE_POLL_MS = 5 * 60_000
export const QUIET_POLL_MS = 15 * 60_000
/** Ask a moment after the event, so the server's clock has passed it too. */
const EVENT_SLACK_MS = 2_000
const MIN_DELAY_MS = 5_000
const RECENT_EVENT_MS = 60_000
const RETRY_MS = 10_000

export function nextPollDelay(view: CrewView, onList: boolean, now: number): number {
  if (onList) return LIST_POLL_MS
  const events: number[] = []
  if (view.active) events.push(view.active.submitFrom, view.active.dueAt, view.active.closesAt)
  if (view.next) events.push(view.next.opensAt)
  // An event that just passed but whose change hasn't shown up yet (the
  // server's clock a little behind, a slow answer): try again shortly.
  if (events.some((t) => t <= now && now - t < RECENT_EVENT_MS)) return RETRY_MS
  const upcoming = events.filter((t) => t > now)
  if (upcoming.length === 0) return view.active ? IDLE_POLL_MS : QUIET_POLL_MS
  const untilEvent = Math.min(...upcoming) - now + EVENT_SLACK_MS
  return Math.max(MIN_DELAY_MS, Math.min(IDLE_POLL_MS, untilEvent))
}
