/** Screens numbers shared by the server, the dashboard and the TV. No Node imports: the browser loads this. */

/** How long a code on the TV stays good before the TV asks for a new one. */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** A screen heard from within this long is "On". The TV checks in every 30 s. */
export const ONLINE_WINDOW_MS = 2 * 60_000

/** How often the TV asks for its playlist. */
export const TV_POLL_MS = 30_000

/**
 * How often it asks while Pusher's socket is up and tells it of changes. A
 * backstop, so it can be slow, but it is also how the dashboard knows the TV
 * is on: it must stay well inside ONLINE_WINDOW_MS or live TVs read "Off".
 */
export const TV_PUSHED_POLL_MS = 60_000

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
/**
 * The owner's own file, kept untouched whenever the TV gets a redrawn copy
 * (a picture bigger than 4K, or over SCREEN_MEDIA_MAX_BYTES). Never sent to a TV.
 */
export const SCREEN_ORIGINAL_MAX_BYTES = 100 * 1024 * 1024
export const SCREEN_ORIGINAL_MAX_PARTS = Math.ceil(SCREEN_ORIGINAL_MAX_BYTES / SCREEN_PART_BYTES)
/** The small copy the dashboard shows. */
export const SCREEN_THUMB_MAX_BYTES = 400 * 1024

/** Bump when the hosted /tv page must be picked up by TVs already showing it. */
export const PLAYER_VERSION = "3"

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
