import { cache } from "react"

/**
 * One read for several day ranges asked for in the same page render.
 *
 * Overview asked the P&L rollup for four ranges at once — yesterday, the same
 * weekday last week, eight Monday weeks and eight weeks to yesterday — and
 * each one read its own rows: four grouped scans of raw orders, four daily
 * summary reads, four food-cost reads, four labor reads (48 queries on a local
 * copy, 24 of them these). P&L asked for three ranges, Labor two.
 *
 * Every one of those reads is "rows of these stores whose day is in
 * [first, last]", so a read of a wider span, cut back to each caller's days,
 * returns exactly the rows the caller's own read would have. That is all this
 * does: callers that arrive within `WINDOW_MS` of each other are grouped by
 * `group` (account, stores, any other filter), overlapping ranges are merged
 * into one read, and each caller gets ITS days back, as its own copy.
 *
 * Ranges are only merged when the merged span is no longer than the ranges'
 * days added up, so a merge never reads more days than the separate reads
 * would have: yesterday plus the same day last week stay two one-day reads
 * rather than becoming one eight-day read.
 *
 * Inside a page render the queue is per request (React `cache`). Outside one
 * (crons, scripts, tests) `cache` hands out a fresh map per call, which this
 * detects, and the read simply runs at once with no wait.
 */

/** Long enough for the sections of one render to arrive; measured 1-7 ms apart in dev. */
export const WINDOW_MS = 8

export interface DayRange {
  /** Inclusive, `YYYY-MM-DD`. */
  first: string
  /** Inclusive, `YYYY-MM-DD`. */
  last: string
}

interface Waiter<Row> {
  range: DayRange
  resolve: (rows: Row[]) => void
  reject: (err: unknown) => void
}

interface Queue<Row> {
  waiters: Waiter<Row>[]
  load: (range: DayRange) => Promise<Row[]>
  dayOf: (row: Row) => string
}

const DAY_MS = 86_400_000
const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00.000Z`) / DAY_MS
const span = (r: DayRange) => dayNum(r.last) - dayNum(r.first) + 1

/**
 * Greedy merge, ranges sorted by first day: a range joins the current read
 * when the joined span is no longer than the days of its members added up.
 * Exported for the test.
 */
export function planReads(ranges: DayRange[]): Array<{ read: DayRange; members: number[] }> {
  const order = ranges.map((r, i) => i).sort((a, b) =>
    ranges[a].first === ranges[b].first
      ? ranges[a].last.localeCompare(ranges[b].last)
      : ranges[a].first.localeCompare(ranges[b].first),
  )
  const plans: Array<{ read: DayRange; members: number[]; days: number }> = []
  for (const i of order) {
    const r = ranges[i]
    const cur = plans[plans.length - 1]
    if (cur) {
      const joined: DayRange = {
        first: cur.read.first,
        last: r.last > cur.read.last ? r.last : cur.read.last,
      }
      if (span(joined) <= cur.days + span(r)) {
        cur.read = joined
        cur.members.push(i)
        cur.days += span(r)
        continue
      }
    }
    plans.push({ read: { ...r }, members: [i], days: span(r) })
  }
  return plans.map(({ read, members }) => ({ read, members }))
}

const queuesThisRequest = cache(() => new Map<string, Queue<unknown>>())

/**
 * Reads already started in this render, per group. A range inside one of
 * them is cut from it rather than read again, whenever it arrives.
 */
const readsThisRequest = cache(
  () => new Map<string, Array<{ range: DayRange; rows: Promise<unknown[]> }>>(),
)

const cut = <Row,>(rows: Row[], range: DayRange, dayOf: (row: Row) => string): Row[] =>
  // Each caller its own copy: one that sorts or edits its rows cannot change
  // what another section reads.
  structuredClone(
    rows.filter((row) => {
      const d = dayOf(row)
      return d >= range.first && d <= range.last
    }),
  )

/** True inside a render, where `cache` returns the same map to every call. */
function inRequest(): boolean {
  return queuesThisRequest() === queuesThisRequest()
}

/**
 * Rows for `range`, read together with any other range of the same `group`
 * asked for in this render. `load` must return every row whose `dayOf` is in
 * the range it is given, and nothing that depends on the range's ends beyond
 * that — then a cut of a wider read equals the narrow read.
 */
export function batchedDayRows<Row>(input: {
  group: string
  range: DayRange
  load: (range: DayRange) => Promise<Row[]>
  dayOf: (row: Row) => string
}): Promise<Row[]> {
  const { group, range, load, dayOf } = input
  if (range.first > range.last) return Promise.resolve([])
  if (!inRequest()) return load(range)

  const started = readsThisRequest().get(group) ?? []
  const covering = started.find((r) => r.range.first <= range.first && r.range.last >= range.last)
  if (covering) return (covering.rows as Promise<Row[]>).then((rows) => cut(rows, range, dayOf))

  const queues = queuesThisRequest()
  let queue = queues.get(group) as Queue<Row> | undefined
  if (!queue) {
    const fresh: Queue<Row> = { waiters: [], load, dayOf }
    queue = fresh
    queues.set(group, fresh as Queue<unknown>)
    setTimeout(() => {
      queues.delete(group)
      flush(group, fresh)
    }, WINDOW_MS)
  }
  const q = queue
  return new Promise<Row[]>((resolve, reject) => {
    q.waiters.push({ range, resolve, reject })
  })
}

function flush<Row>(group: string, queue: Queue<Row>): void {
  const { waiters, load, dayOf } = queue
  const reads = readsThisRequest()
  const list = reads.get(group) ?? []
  reads.set(group, list)
  for (const plan of planReads(waiters.map((w) => w.range))) {
    // Through a promise, so a loader that throws synchronously still rejects
    // its callers instead of leaving them waiting.
    const rows = Promise.resolve().then(() => load(plan.read))
    const entry = { range: plan.read, rows: rows as Promise<unknown[]> }
    list.push(entry)
    // A failed read is dropped so a later caller in the render reads again.
    rows.catch(() => {
      const at = list.indexOf(entry)
      if (at >= 0) list.splice(at, 1)
    })
    rows.then(
      (all) => {
        for (const i of plan.members) waiters[i].resolve(cut(all, waiters[i].range, dayOf))
      },
      (err) => {
        for (const i of plan.members) waiters[i].reject(err)
      },
    )
  }
}

/** `YYYY-MM-DD` of a date's UTC calendar day (`@db.Date` columns sit at UTC midnight). */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10)

/** UTC midnight of a `YYYY-MM-DD`. */
export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
