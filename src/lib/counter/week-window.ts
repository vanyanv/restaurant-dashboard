/**
 * Which seven days "this week" means, and what each of them is called.
 *
 * Three callers need the same answer and must not each derive their own:
 *
 *   - `src/lib/counter/adapters/decisions.ts` queries `ForecastDailyRevenue`
 *     back to the week's START for the days that have already settled, and
 *     labels every picker cell.
 *   - `src/app/dashboard/(counter)/decisions/counter-decisions-client.tsx`
 *     prints the window under the page title and the selected day's name in a
 *     section heading — before that section's data has arrived, so it cannot
 *     read the label off it.
 *   - `src/app/(mobile)/m/(counter)/decisions/counter-phone-decisions-client.tsx`
 *     prints the same window in `.msub`.
 *
 * A desk saying "Aug 24 – 30" over a picker the adapter built from Sunday to
 * Saturday is the same defect as two surfaces asking two loaders — one
 * restaurant, two weeks — so the week is decided once, here.
 *
 * **Everything is UTC.** `ForecastDailyRevenue.forecastDate` is `@db.Date`
 * (UTC midnight) and `DecisionsView.asOf` is `ymdUTC(new Date())`, so a
 * local-zone floor would drop or duplicate a day whenever the process runs
 * west of Greenwich — which local dev always does. See `src/lib/date-utils.ts`.
 *
 * **Monday starts the week**, which is the prototype's own: `P.decisions`'s
 * `WK` runs Mon 24 → Sun 30 and 2026-08-24 is a Monday. It is also the week a
 * restaurant schedules against.
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `"2026-08-29"` -> a UTC-midnight `Date`, or null when it is not a day key. */
export function parseDayKey(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const t = Date.parse(`${iso}T00:00:00.000Z`)
  return Number.isNaN(t) ? null : new Date(t)
}

/** The Monday of the week containing `d`, at UTC midnight. Never mutates `d`. */
export function weekStartUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  // getUTCDay: 0 = Sunday. Sunday belongs to the week that STARTED six days
  // earlier, not to the one about to start.
  const back = (out.getUTCDay() + 6) % 7
  out.setUTCDate(out.getUTCDate() - back)
  return out
}

/** The seven day keys of the week containing `d`, Monday first. */
export function weekDayKeys(d: Date): string[] {
  const start = weekStartUTC(d)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + i)
    return day.toISOString().slice(0, 10)
  })
}

/**
 * `"2026-08-29"` -> `"Sat 29"` — what a `.wkd` cell prints and what the day
 * detail section titles itself with.
 *
 * Returns the key unchanged when it is not a day key, rather than throwing:
 * the string can arrive from the URL.
 */
export function weekDayLabel(iso: string): string {
  const d = parseDayKey(iso)
  if (d === null) return iso
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()}`
}

/**
 * `"Aug 24 – 30"`, or `"Aug 30 – Sep 5"` when the week crosses a month.
 *
 * The prototype's own `.msub` (line 4763) is the first form; the second is
 * what that form has to become five weeks in twelve, and printing "Aug 30 – 5"
 * would name a day in no month at all.
 */
export function weekLabel(d: Date): string {
  const start = weekStartUTC(d)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const head = `${MONTH[start.getUTCMonth()]} ${start.getUTCDate()}`
  const tail =
    start.getUTCMonth() === end.getUTCMonth()
      ? `${end.getUTCDate()}`
      : `${MONTH[end.getUTCMonth()]} ${end.getUTCDate()}`
  return `${head} – ${tail}`
}
