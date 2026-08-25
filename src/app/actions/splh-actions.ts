"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import {
  buildSplhSeries,
  buildSplhSeriesRolling,
  rollToWeeks,
  blendedHourlyRate,
  type SplhInput,
  type SplhPoint,
} from "@/lib/splh"

/** Days shown as bars in the day view. */
const DAY_WINDOW = 14
/** Weeks shown as bars in the week view. */
const WEEK_WINDOW = 12
/**
 * Trailing history used to derive weekday targets. Long enough that one odd
 * week can't move the median, short enough to track a real trend.
 */
const TARGET_HISTORY_DAYS = 56
/** Trailing weeks a week bar is scored against. */
const ROLLING_WEEKS = 8

/**
 * An explicit window to report on, instead of the trailing one this action
 * derives for itself.
 *
 * Deliberately `{ startDate, endDate }` — the shape of
 * `src/app/actions/_shared/date-range.ts`, which is what every existing query
 * in this layer speaks and which treats `endDate` as an INCLUSIVE bound. It
 * is NOT Counter's `{ start, end }` (`src/lib/counter/date-range.ts`), whose
 * `end` is a local midnight. A Counter caller converts with `toQueryBounds`
 * before calling; handing the raw `end` in would silently drop the last day
 * of every range, which is the whole reason that helper exists.
 */
export interface SplhRange {
  startDate: Date
  endDate: Date
}

export interface SplhSeries {
  storeId: string
  storeName: string
  points: SplhPoint[]
  /** Blended $/hr across the history window — the units for variance dollars. */
  blendedRate: number | null
  /** Days in the window that have BOTH sales and labor hours. */
  daysCovered: number
  /** Days in the window with sales but no labor hours. */
  daysMissingHours: number
}

type JoinedRow = { date: Date; net: number | null; hours: number | null; cost: number | null }

/**
 * The calendar day a `Date` names, read off its LOCAL fields.
 *
 * The rows come back from a `@db.Date` column as UTC midnights, so their own
 * day string is `toISOString().slice(0, 10)`. A `range` bound does NOT: it is
 * a local midnight (see `SplhRange`), and `toISOString()` on one shifts the
 * calendar date by a day wherever the server clock is not UTC. Both sides of
 * the comparison have to name the same calendar day, so the bound is read the
 * way it was written.
 */
function calendarDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * SPLH for the owner's stores. Labor hours come from HarriPositionDaily
 * (`actualSeconds`), sales from OtterHourlySummary — both are LA-calendar
 * daily grain, so they join on (storeId, date) directly.
 *
 * Returns one series per store that has any labor hours at all; stores still
 * in construction have no Harri rows and are omitted rather than rendered as
 * an empty axis.
 *
 * `range` is OPTIONAL and additive. Omit it and the action behaves exactly as
 * it always has: a trailing 14-day (or 12-week) window ending today. Pass one
 * and the bars are the days of THAT window — which is what Counter needs,
 * because a trailing SPLH printed beside a range-scoped net sales figure
 * answers a different question under the same label (note 60's defect class,
 * and the reason Plan 7 ruled Overview's SPLH `not_computed` rather than
 * showing the trailing number).
 *
 * The scored window and the QUERIED window are not the same thing either way.
 * A day is scored against the median of the same weekday before it, so the
 * query always reaches TARGET_HISTORY_DAYS further back than the first bar
 * shown; those extra rows are history, never bars. `endDate` is used verbatim
 * as the upper bound so the last day of the range is included.
 */
export async function getSplhSeries(
  granularity: "day" | "week" = "day",
  range?: SplhRange,
): Promise<SplhSeries[]> {
  const session = await getServerSession(authOptions)
  if (!session || !hasOwnerAccess(session.user.role)) return []

  const windowDays =
    granularity === "week" ? WEEK_WINDOW * 7 : DAY_WINDOW
  const lookbackDays = windowDays + TARGET_HISTORY_DAYS

  const since = new Date(range ? range.startDate : Date.now())
  if (!range) since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - (range ? TARGET_HISTORY_DAYS : lookbackDays))
  // No upper bound without a range: the trailing window ends at "the newest
  // row there is", which is what every existing caller already gets.
  const until = range?.endDate ?? null

  const rangeStartDay = range ? calendarDay(range.startDate) : null
  const rangeEndDay = range ? calendarDay(range.endDate) : null

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
  })
  if (stores.length === 0) return []

  const storeIds = stores.map((s) => s.id)

  // One pass: labor hours + cost per (store, day) joined to net sales.
  // OtterHourlySummary is the sales side because it is already LA-calendar
  // bucketed; its netSales reconciles with OtterDailySummary to ~0.1%.
  const salesUpper = until ? Prisma.sql`AND "date" <= ${until}` : Prisma.empty
  const laborUpper = until ? Prisma.sql`AND h."date" <= ${until}` : Prisma.empty
  const rows = await prisma.$queryRaw<Array<JoinedRow & { storeId: string }>>(Prisma.sql`
    SELECT h."storeId",
           h."date",
           SUM(h."actualSeconds") / 3600.0            AS hours,
           SUM(COALESCE(h."totalLabor", 0))           AS cost,
           s.net                                      AS net
      FROM "HarriPositionDaily" h
      LEFT JOIN (
        SELECT "storeId", "date", SUM("netSales") AS net
          FROM "OtterHourlySummary"
         WHERE "storeId" IN (${Prisma.join(storeIds)}) AND "date" >= ${since} ${salesUpper}
         GROUP BY "storeId", "date"
      ) s ON s."storeId" = h."storeId" AND s."date" = h."date"
     WHERE h."storeId" IN (${Prisma.join(storeIds)}) AND h."date" >= ${since} ${laborUpper}
     GROUP BY h."storeId", h."date", s.net
     ORDER BY h."date" ASC
  `)

  const byStore = new Map<string, SplhInput[]>()
  for (const r of rows) {
    const list = byStore.get(r.storeId) ?? []
    list.push({
      date: r.date.toISOString().slice(0, 10),
      netSales: Number(r.net ?? 0),
      laborHours: Number(r.hours ?? 0),
      laborCost: Number(r.cost ?? 0),
    })
    byStore.set(r.storeId, list)
  }

  const out: SplhSeries[] = []
  for (const store of stores) {
    const all = byStore.get(store.id)
    if (!all || all.length === 0) continue

    const daily = all

    // Which rows are BARS. Without a range it is the trailing window, exactly
    // as before. With one it is the days of that range — and only those; the
    // rest of what was queried is history for the medians.
    const inRange = (date: string): boolean =>
      rangeStartDay === null || rangeEndDay === null
        ? true
        : date >= rangeStartDay && date <= rangeEndDay

    let points: SplhPoint[]
    if (granularity === "week") {
      // Weeks roll against the 8 weeks before each one, so the line tracks a
      // store that improves instead of pinning it to a stale block.
      const weeks = rollToWeeks(daily, { dropPartial: true })
      // `buildSplhSeriesRolling` shows the LAST `showCount` entries, and the
      // query already ends at the range's last day — so counting the weeks
      // that start inside the range is enough to select them. A range with no
      // whole week in it (dropPartial) shows nothing rather than borrowing the
      // week before it.
      const showCount = range
        ? weeks.filter((w) => inRange(w.date)).length
        : WEEK_WINDOW
      points = buildSplhSeriesRolling(weeks, showCount, ROLLING_WEEKS, {
        weekly: true,
      })
    } else {
      // Days compare against the median for the SAME weekday — a flat target
      // would just redraw the volume curve and condemn every Tuesday.
      const shown = range ? daily.filter((r) => inRange(r.date)) : daily.slice(-DAY_WINDOW)
      const firstShown = shown[0]?.date ?? ""
      const history = daily.filter((r) => r.date < firstShown)
      points = buildSplhSeries(shown, history.length > 0 ? history : daily)
    }

    // Coverage counts the days the caller ASKED about. Without a range that is
    // the whole lookback, unchanged. With one it is the range's own days —
    // reporting "56 days covered" under a label that says "Aug 18–24" is the
    // same defect as showing a trailing SPLH beside a range-scoped total.
    const counted = range ? daily.filter((r) => inRange(r.date)) : daily

    out.push({
      storeId: store.id,
      storeName: store.name,
      points,
      blendedRate: blendedHourlyRate(daily),
      daysCovered: counted.filter((r) => r.laborHours > 0 && r.netSales > 0).length,
      daysMissingHours: counted.filter((r) => r.laborHours <= 0 && r.netSales > 0).length,
    })
  }

  return out
}
