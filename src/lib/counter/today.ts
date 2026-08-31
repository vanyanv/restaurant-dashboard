/**
 * What day it is, asked once so a test run can answer it deterministically.
 *
 * ## Why this exists
 *
 * The fidelity suite compares our render against the prototype's, and the
 * manifest already pins the *range* (`query: "?range=d7&cmp=weekday"`) so both
 * sides answer the same question. It could not pin the *date*, and that gap
 * had a shape: `trailingWeeks` deliberately includes the running week clipped
 * to today, so on a Monday morning the eighth row of the P&L's week table is a
 * one-day-old week with nothing synced into it — no sales, no labour, so no
 * prime cost, so `WeekTable` draws no `.mtr` for it. The prototype always draws
 * eight, because its figures are invented.
 *
 * That is not a defect in the page. It is a gate measuring a moving target,
 * and it failed one day in seven, forever. A suite that is red every Monday is
 * as ignorable as the permanently green one that let the fidelity gap open in
 * the first place — so the clock is pinned, exactly as the range is.
 *
 * ## The production guard is `VERCEL_ENV`, not `NODE_ENV`
 *
 * The obvious guard would be `NODE_ENV !== "production"`, and it is wrong here:
 * `docs/counter/fidelity/README.md` requires the second fidelity run to come
 * from a cold `npm run build && npm run start`, which IS `NODE_ENV=production`.
 * Gating on it would silently un-pin the clock for the only run that counts.
 *
 * `VERCEL_ENV` is set by the platform on every deployment, preview and
 * production alike, and is never set by a local build. So the rule is: the
 * override is honoured nowhere that Vercel runs it, and the environment
 * variable cannot be smuggled into a deployment to move the clock — setting it
 * in the project's env vars does nothing at all.
 *
 * ## It is a DATE, not a timestamp
 *
 * `COUNTER_TODAY=2026-08-28` resolves to that local midnight, because every
 * consumer immediately floors it (`startOfDay`, `weekStart`, `resolvePreset`).
 * Accepting a time would imply a precision none of them keep. A value that is
 * not a `YYYY-MM-DD` is ignored rather than throwing: a malformed pin should
 * degrade to the real clock, not take the app down.
 */

const PINNED = /^\d{4}-\d{2}-\d{2}$/

/**
 * Today, for anything that composes a Counter page.
 *
 * Returns a fresh `Date` on every call — callers pass it into adapters that
 * are free to mutate their own copies, and a shared instance would let one
 * page's `setUTCDate` move another's.
 */
export function counterToday(): Date {
  const pin = process.env.COUNTER_TODAY
  if (
    pin !== undefined &&
    PINNED.test(pin) &&
    // Never on a deployment. See the docblock: this is the guard, not NODE_ENV.
    process.env.VERCEL_ENV === undefined
  ) {
    // Local midnight, to match what `startOfDay(new Date())` would have given
    // — a `Date.parse` of the bare date string would be UTC midnight and put
    // the whole app a day early for every caller west of Greenwich.
    const [y, m, d] = pin.split("-").map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date()
}
