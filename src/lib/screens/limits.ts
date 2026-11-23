/** Screens numbers shared by the server, the dashboard and the TV. No Node imports: the browser loads this. */

/** How long a code on the TV stays good before the TV asks for a new one. */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** A screen heard from within this long is "On". The TV checks in every 30 s. */
export const ONLINE_WINDOW_MS = 2 * 60_000

/** How often the TV asks for its playlist. */
export const TV_POLL_MS = 30_000

/** lastSeenAt is written at most this often per screen, so polling is not a write per call. */
export const SEEN_WRITE_EVERY_MS = 60_000

/** Seconds a slide stays up, when a playlist has more than one. */
export const SLIDE_SECONDS_MIN = 3
export const SLIDE_SECONDS_MAX = 600
export const SLIDE_SECONDS_DEFAULT = 10

