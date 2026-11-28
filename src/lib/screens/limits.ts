/** Screens numbers shared by the server, the dashboard and the TV. No Node imports: the browser loads this. */

/** How long a code on the TV stays good before the TV asks for a new one. */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** A screen heard from within this long is "On". A TV says it is on every TV_BEAT_MS (3 min); two beats in a row can fail (a 9 min gap) before it reads "Off". */
export const ONLINE_WINDOW_MS = 10 * 60_000

/** How often a TV on the old player (before version 4) asks /api/tv/content for its playlist. */
export const TV_POLL_MS = 30_000

/**
 * The player from version 4 on asks /api/tv/c/<token>, which Vercel's CDN answers
 * without running the server, Redis or the database until something changes.
 * It asks every TV_POLL_FAST_MS while it has no push line open, and every
 * TV_POLL_SLOW_MS while it has: the push says "changed" at once, so the slow
 * ask is only there in case the line has died without saying so.
 */
export const TV_POLL_FAST_MS = 15_000
export const TV_POLL_SLOW_MS = 120_000
/**
 * With no push line for longer than TV_POLL_FAST_FOR_MS (Ably is down, or not
 * set up) the TV stops asking every 15 s and asks this often instead. Every
 * ask is a request Vercel counts, and a month of 15 s asks from every TV does
 * not fit in the plan's allowance.
 */
export const TV_POLL_DOWN_MS = 60_000
export const TV_POLL_FAST_FOR_MS = 10 * 60_000

/** How often a TV tells /api/tv/beat it is on, and sets its clock from the answer. */
export const TV_BEAT_MS = 3 * 60_000

/** After a push says "changed" the TV asks at once, then again after each of these, in case the CDN was still clearing. */
export const TV_NUDGE_RETRY_MS = [3_000, 10_000] as const

/** lastSeenAt is written at most this often per screen, so polling is not a write per call. */
export const SEEN_WRITE_EVERY_MS = 60_000

/** Seconds a slide stays up, when a playlist has more than one. */
export const SLIDE_SECONDS_MIN = 3
export const SLIDE_SECONDS_MAX = 600
export const SLIDE_SECONDS_DEFAULT = 10


/** How long "Which TV is which?" keeps each TV's name up. Long enough for a TV that has just checked in. */
export const IDENTIFY_MS = 90_000

/** Pictures on one screen, and windows of the week on one screen. */
export const SLIDES_MAX = 50
export const TIMES_MAX = 6

/** A picture is sent as it is, up to this. Past it the browser makes a lighter copy. */
export const SCREEN_MEDIA_MAX_BYTES = 25 * 1024 * 1024
/** Vercel refuses a request body over 4.5 MB, so a bigger picture travels in parts this size. */
export const SCREEN_PART_BYTES = 4 * 1024 * 1024
export const SCREEN_MAX_PARTS = Math.ceil(SCREEN_MEDIA_MAX_BYTES / SCREEN_PART_BYTES)
/** The small copy the dashboard shows. */
export const SCREEN_THUMB_MAX_BYTES = 400 * 1024

/** Bump when the hosted /tv page must be picked up by TVs already showing it. */
export const PLAYER_VERSION = "4"

/** Every store is in Los Angeles; windows of the week are in store time. */
export const SCREEN_TZ = "America/Los_Angeles"

export const EVERY_DAY = 127

export type TimeWindow = { days: number; start: number; end: number }

/** Does this window cover the minute? `day` is 0 for Sunday. A window past midnight belongs to the day it started. */
export function inWindow(w: TimeWindow, day: number, minute: number): boolean {
  const on = (d: number) => (w.days & (1 << ((d + 7) % 7))) !== 0
  if (w.end > w.start) return on(day) && minute >= w.start && minute < w.end
  return (on(day) && minute >= w.start) || (on(day - 1) && minute < w.end)
}

/** The window on now, or null. When two overlap, the one added last wins. */
export function activeTime<T extends TimeWindow>(times: readonly T[], day: number, minute: number): T | null {
  for (let i = times.length - 1; i >= 0; i--) if (inWindow(times[i], day, minute)) return times[i]
  return null
}

/** "11 am to 3 pm". The same minute at both ends is all day. */
export function windowWords(w: TimeWindow): string {
  const at = (m: number) => {
    const h = Math.floor((m % 1440) / 60)
    const mm = m % 60
    return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`
  }
  const when = w.start % 1440 === w.end % 1440 ? "all day" : `${at(w.start)} to ${at(w.end)}`
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  if (w.days === EVERY_DAY) return when
  const days = names.filter((_, i) => w.days & (1 << i)).join(", ")
  return `${days}, ${when}`
}
