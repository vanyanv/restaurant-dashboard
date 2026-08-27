import { prisma } from "@/lib/prisma"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"

/**
 * When the orders come, hour by hour — and which day of the week is worth
 * more.
 *
 * `OtterHourlySummary` is the ONLY source this module reads. It is a
 * purpose-built rollup: `storeId`, `date` (`@db.Date`, an LA calendar date),
 * `hour` (0–23, LA LOCAL hour, already resolved), `orderCount`, `netSales`.
 * That matters because the obvious alternative — `OtterOrder.referenceTimeLocal`
 * — stores local time encoded as a UTC epoch, and reading it with anything but
 * `getUTCHours()` silently shifts every hour by the timezone offset (A-R5).
 * `OtterHourlySummary` avoids the trap by construction: there is no timezone
 * arithmetic left for a caller to get wrong.
 *
 * A-R15 — THE HOUR AXIS IS THE SERVICE DAY, NOT THE CLOCK. This restaurant
 * trades from about 10am to about 2am, so the hours after midnight belong to
 * the evening that produced them. `hours` (and the peak-block search below)
 * are ordered from the first hour that traded to the last — `10, 11, … 23, 0,
 * 1, 2` — never a clock-ordered `0..23`, which would put the busiest hour of
 * the night at the far left of the chart next to the morning. The prototype's
 * own `HOURS` axis (`11a`..`10p`, twelve labels) does not cover this
 * restaurant's actual hours at all: 25.8% of orders fall outside it, including
 * hour 23 — the single busiest hour measured. That prototype window is not
 * reproduced here.
 */

export interface HourReading {
  /** 0–23, LA local hour. */
  hour: number
  /** Average orders in this hour on a day of the range. */
  orders: number
}

export interface PeakBlock {
  startHour: number
  endHour: number
  /** Share of the range's orders landing in the block, 0..100. */
  share: number
  /** "7p to midnight" — written the way the prototype writes an hour. */
  label: string
}

export interface ServiceProfile {
  hours: HourReading[]
  /** Distinct dates the hourly table covered in the range. */
  coveredDays: number
  /** Average orders on a covered day. */
  perDay: number
  /** The hour with the most orders. */
  busiest: number
  /** The best contiguous five hours, and their share of the day (A-R6). */
  peak: PeakBlock
}

export interface DayOfWeekReading {
  /** 0 = Monday, matching the chart's Mon-first labels. */
  day: number
  name: string
  /** Average net on this weekday across the range. `null` with no day in range. */
  average: number | null
  /** How many of this weekday the range held. */
  days: number
}

export interface DayOfWeekProfile {
  readings: DayOfWeekReading[]
  /** The mean across the days that are IN the range. */
  mean: number
  /** Index into `readings` of the best day, or `null` when the range holds none. */
  best: number | null
}

/**
 * A stable per-calendar-day key for an `OtterHourlySummary.date` value.
 *
 * `toISOString().slice(0, 10)` — not local getters — matching the existing
 * read path for this exact table (`getHourlyOrderPatterns`,
 * `hourly-orders-actions.ts`). The column is `@db.Date`, so its Date object
 * carries no time-of-day to be shifted; UTC fields read it back unchanged.
 */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The service-day rotation of a set of present hours (A-R15).
 *
 * `hours` must already be unique and sorted ascending, 0–23. This walks the
 * circular gaps between consecutive present hours (wrapping from the last
 * back to the first) and starts the axis right after the LARGEST gap — the
 * stretch of the clock the restaurant is closed. For this restaurant's real
 * hours (`0,1,2,10..23`) the biggest gap is between `2` and `10` — the
 * overnight closure — so the axis starts at `10` and ends at `2`, exactly the
 * service day. A fixture with no overnight gap at all (e.g. `10..14`) has its
 * largest gap on the wrap itself, so the axis starts back at its own first
 * hour and never rotates.
 *
 * Exported so `src/lib/counter/staffing-curve.ts` (L-R7) can order its own
 * hour axis the same way — one restaurant, one day shape, not a second
 * rotation invented on the labour page that could disagree with this one.
 */
export function serviceDayOrder(hours: number[]): number[] {
  if (hours.length <= 1) return hours.slice()

  let bestGapAt = 0
  let bestGap = -1
  for (let i = 0; i < hours.length; i += 1) {
    const cur = hours[i]
    const next = hours[(i + 1) % hours.length]
    const gap = next > cur ? next - cur : next + 24 - cur
    if (gap > bestGap) {
      bestGap = gap
      bestGapAt = i
    }
  }

  const startAt = (bestGapAt + 1) % hours.length
  return [...hours.slice(startAt), ...hours.slice(0, startAt)]
}

/**
 * An hour written the way the prototype's `HOURS` list writes one — `8p`,
 * `11a` — extended with the two labels that list never needed because it
 * never crossed either boundary: `midnight` for 0 and `noon` for 12.
 */
function hourWord(hour: number): string {
  if (hour === 0) return "midnight"
  if (hour === 12) return "noon"
  return hour < 12 ? `${hour}a` : `${hour - 12}p`
}

/**
 * "8p to 1a" — the block's first hour, and the clock hour right AFTER its
 * last one. The block itself is inclusive of `endHour` (a 20–0 block holds
 * five hours: 20, 21, 22, 23, 0), so the label's second half is `endHour + 1`,
 * wrapping past midnight the same way the block itself does.
 */
function blockLabel(startHour: number, endHour: number): string {
  const after = (endHour + 1) % 24
  return `${hourWord(startHour)} to ${hourWord(after)}`
}

const PEAK_WINDOW = 5

/**
 * Every contiguous five-hour window IN SERVICE-DAY ORDER, scored by its share
 * of the day's orders. Scans only `order[0..length-5]` — never circularly
 * past the array's own end — so a block may span `11p → 12a` (real hours
 * crossing midnight, because `order` already carries that rotation) but can
 * never wrap past the SERVICE DAY'S OWN END the way a `% order.length` scan
 * would (A-R6): a restaurant trading only 10h–14h has exactly one five-hour
 * window, not a family of rotations of it.
 */
function computePeakBlock(
  order: number[],
  sumByHour: Map<number, number>,
  total: number,
): PeakBlock {
  const sumOf = (hour: number) => sumByHour.get(hour) ?? 0

  if (order.length <= PEAK_WINDOW) {
    const sum = order.reduce((s, h) => s + sumOf(h), 0)
    const startHour = order[0]
    const endHour = order[order.length - 1]
    return {
      startHour,
      endHour,
      share: total > 0 ? Math.round((sum / total) * 1000) / 10 : 0,
      label: blockLabel(startHour, endHour),
    }
  }

  let bestSum = -Infinity
  let bestStart = 0
  for (let i = 0; i <= order.length - PEAK_WINDOW; i += 1) {
    let sum = 0
    for (let k = 0; k < PEAK_WINDOW; k += 1) sum += sumOf(order[i + k])
    if (sum > bestSum) {
      bestSum = sum
      bestStart = i
    }
  }

  const startHour = order[bestStart]
  const endHour = order[bestStart + PEAK_WINDOW - 1]
  return {
    startHour,
    endHour,
    share: total > 0 ? Math.round((bestSum / total) * 1000) / 10 : 0,
    label: blockLabel(startHour, endHour),
  }
}

/**
 * Pure. Given rows the loader fetched, the shape.
 *
 * The three-day floor (A-R7) is what stops a `pre_open` store's single stray
 * hourly row (Glendale carries exactly one) from being drawn as a service
 * profile — a chart with a single day behind it is not a shape, it is a
 * sample. `null` here, same as the loader, is the caller's cue to render
 * `not_computed` rather than a one-bar chart.
 */
export function serviceProfile(
  rows: Array<{ hour: number; date: Date; orderCount: number }>,
): ServiceProfile | null {
  if (rows.length === 0) return null

  const dayKeys = new Set<string>()
  const sumByHour = new Map<number, number>()

  for (const r of rows) {
    dayKeys.add(dateKey(r.date))
    sumByHour.set(r.hour, (sumByHour.get(r.hour) ?? 0) + r.orderCount)
  }

  const coveredDays = dayKeys.size
  if (coveredDays < 3) return null

  const presentHours = Array.from(sumByHour.keys()).sort((a, b) => a - b)
  const order = serviceDayOrder(presentHours)

  const totalOrders = presentHours.reduce((s, h) => s + (sumByHour.get(h) ?? 0), 0)

  const hours: HourReading[] = order.map((h) => ({
    hour: h,
    orders: (sumByHour.get(h) ?? 0) / coveredDays,
  }))

  let busiest = order[0]
  let bestHourSum = -Infinity
  for (const h of order) {
    const s = sumByHour.get(h) ?? 0
    if (s > bestHourSum) {
      bestHourSum = s
      busiest = h
    }
  }

  return {
    hours,
    coveredDays,
    perDay: totalOrders / coveredDays,
    busiest,
    peak: computePeakBlock(order, sumByHour, totalOrders),
  }
}

const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]

/** Monday-first index (0=Mon..6=Sun) from JS's Sunday-first `getDay()` (0=Sun..6=Sat). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

/**
 * Pure. Given per-bucket net keyed by calendar date, the weekday shape.
 *
 * A weekday the range never held reads `average: null`, never `0` — a day
 * that did not happen is not a day that sold nothing. `mean` is the mean of
 * the SEVEN averages weighted by their day counts, which is arithmetically
 * the same figure as the plain mean over every day supplied (both reduce to
 * total net over total days) — stated as the weighted form because that is
 * the reading a caller with only the seven `DayOfWeekReading`s in hand, and
 * not the original day list, can still reproduce.
 */
export function dayOfWeekProfile(
  days: Array<{ date: Date; net: number }>,
): DayOfWeekProfile {
  const sums = new Array(7).fill(0) as number[]
  const counts = new Array(7).fill(0) as number[]

  for (const { date, net } of days) {
    const idx = mondayIndex(date)
    sums[idx] += net
    counts[idx] += 1
  }

  const readings: DayOfWeekReading[] = WEEKDAY_NAMES.map((name, day) => ({
    day,
    name,
    average: counts[day] > 0 ? sums[day] / counts[day] : null,
    days: counts[day],
  }))

  const totalNet = sums.reduce((a, b) => a + b, 0)
  const totalDays = counts.reduce((a, b) => a + b, 0)
  const mean = totalDays > 0 ? totalNet / totalDays : 0

  let best: number | null = null
  let bestAverage = -Infinity
  readings.forEach((r, i) => {
    if (r.average !== null && r.average > bestAverage) {
      bestAverage = r.average
      best = i
    }
  })

  return { readings, mean, best }
}

/**
 * The loader. Returns `null` when the range starts before the hourly table
 * begins, or when fewer than three days are covered (A-R5, A-R7) — the caller
 * turns that into `not_computed`, never an empty chart.
 *
 * Both conditions are the SAME guard, enforced once, inside `serviceProfile`:
 * a range that starts before the table begins simply has no rows for its
 * earliest days, which is indistinguishable from — and handled the same way
 * as — a store with too little hourly history. There is no second check here
 * for "predates the table" as its own case.
 *
 * Resolves stores through `accountId` FIRST, the same reason
 * `loadChannelMix` does: without it, `storeId: null` would mean "every store
 * in the database". A `storeId` not on the account resolves to no stores and
 * returns `null`, never to the whole account.
 *
 * This module deliberately does not fetch its own session — importing
 * `@/lib/auth` pulls in `@/lib/prisma` at MODULE LOAD, which throws without
 * `DATABASE_URL` and takes every importer down with it, tests included. The
 * caller already has an accountId from its own session lookup.
 */
export async function loadServiceProfile(input: {
  range: DateRange
  storeId: string | null
  accountId: string
}): Promise<ServiceProfile | null> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await prisma.store.findMany({
    where: {
      accountId,
      isActive: true,
      ...(storeId ? { id: storeId } : {}),
    },
    select: { id: true },
  })
  if (stores.length === 0) return null

  const storeIds = stores.map((s) => s.id)

  const rows = await prisma.otterHourlySummary.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: startDate, lte: endDate },
    },
    select: { hour: true, date: true, orderCount: true },
  })

  return serviceProfile(rows)
}
