/**
 * Pacific-pinned time formatting for the monitoring surface.
 *
 * Every panel here is labelled "PT" by the masthead, but Vercel's Node runtime
 * is UTC — so a formatter built on `getHours()`/`getDate()` renders UTC in
 * production while claiming Pacific. Evening activity lands on the wrong day,
 * and because these are server components there is no hydration warning to
 * betray it: the timestamps are simply, silently wrong.
 *
 * Pinning both the timeZone AND the locale also keeps server and client output
 * identical, which is what stops a client component from hydration-mismatching
 * against its own SSR pass.
 *
 * Day bucketing (as opposed to display) lives in `dayKey` in
 * `src/lib/monitoring/engagement.ts` and uses the same zone.
 */

export const LA_TZ = "America/Los_Angeles"

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ,
  month: "short",
  day: "2-digit",
})

const CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TZ,
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than hour12:false — the latter renders midnight as "24:00".
  hourCycle: "h23",
})

/** `14:07` in Pacific. Accepts a Date or anything Date-like that survived a
 * server/client boundary as a string. */
export function fmtClockPT(d: Date | string): string {
  return CLOCK_FMT.format(new Date(d))
}

/** `Aug 13` in Pacific. */
export function fmtDayPT(d: Date | string): string {
  return DAY_FMT.format(new Date(d))
}

/** `Aug 13 · 14:07` in Pacific. */
export function fmtStampPT(d: Date | string): string {
  const date = new Date(d)
  return `${DAY_FMT.format(date)} · ${CLOCK_FMT.format(date)}`
}
