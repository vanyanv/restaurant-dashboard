import { cache } from "react"
import { WINDOW_MS } from "@/lib/counter/day-batch"

/**
 * One read for several store sets asked for in the same page render.
 *
 * Week ahead builds the all-stores view and then one view per store for the
 * store cards, and each view read the same tables over the same dates for its
 * own stores: 85 queries with two stores on a local copy, about thirteen more
 * for every store added. Every one of those reads is "rows of these stores in
 * this window", so one read of every store asked for, cut back to each
 * caller's stores, returns exactly the rows each caller's own read would have.
 *
 * Callers that arrive within `WINDOW_MS` of each other with the same `group`
 * (the table, the window and any other filter — everything but the stores)
 * share one read of the union of their stores; each gets back the rows of ITS
 * stores, as its own copy. A read that is cut by row count (`take`) must not
 * use this: the limit would apply to the union, not to each caller.
 *
 * Inside a render the queue is per request (React `cache`); outside one the
 * read runs at once, as in `./day-batch`.
 */

interface Waiter<Row> {
  storeIds: string[]
  resolve: (rows: Row[]) => void
  reject: (err: unknown) => void
}

interface Queue<Row> {
  waiters: Waiter<Row>[]
  load: (storeIds: string[]) => Promise<Row[]>
  storeOf: (row: Row) => string
}

const queuesThisRequest = cache(() => new Map<string, Queue<unknown>>())

/**
 * Reads already started in this render, per group. A caller whose stores are
 * all inside one of them is cut from it rather than waiting for a new read:
 * Week ahead's all-stores view starts well before the per-store cards ask.
 */
const readsThisRequest = cache(
  () => new Map<string, Array<{ ids: Set<string>; rows: Promise<unknown[]> }>>(),
)

const cut = <Row,>(rows: Row[], ids: string[], storeOf: (row: Row) => string): Row[] => {
  const mine = new Set(ids)
  // Each caller its own copy, so none can change another's rows.
  return structuredClone(rows.filter((row) => mine.has(storeOf(row))))
}

function inRequest(): boolean {
  return queuesThisRequest() === queuesThisRequest()
}

export function batchedStoreRows<Row>(input: {
  group: string
  storeIds: string[]
  load: (storeIds: string[]) => Promise<Row[]>
  storeOf: (row: Row) => string
}): Promise<Row[]> {
  const { group, storeIds, load, storeOf } = input
  if (storeIds.length === 0) return Promise.resolve([])
  if (!inRequest()) return load(storeIds)

  const started = readsThisRequest().get(group) ?? []
  const covering = started.find((r) => storeIds.every((id) => r.ids.has(id)))
  if (covering) return (covering.rows as Promise<Row[]>).then((rows) => cut(rows, storeIds, storeOf))

  const queues = queuesThisRequest()
  let queue = queues.get(group) as Queue<Row> | undefined
  if (!queue) {
    const fresh: Queue<Row> = { waiters: [], load, storeOf }
    queue = fresh
    queues.set(group, fresh as Queue<unknown>)
    setTimeout(() => {
      queues.delete(group)
      flush(group, fresh)
    }, WINDOW_MS)
  }
  const q = queue
  return new Promise<Row[]>((resolve, reject) => {
    q.waiters.push({ storeIds, resolve, reject })
  })
}

function flush<Row>(group: string, queue: Queue<Row>): void {
  const { waiters, load, storeOf } = queue
  const union = [...new Set(waiters.flatMap((w) => w.storeIds))].sort()
  const rows = load(union)
  const reads = readsThisRequest()
  const list = reads.get(group) ?? []
  const entry = { ids: new Set(union), rows: rows as Promise<unknown[]> }
  list.push(entry)
  reads.set(group, list)
  // A failed read is dropped so a later caller in the render reads again.
  rows.catch(() => {
    const at = list.indexOf(entry)
    if (at >= 0) list.splice(at, 1)
  })
  rows.then(
    (all) => {
      for (const w of waiters) w.resolve(cut(all, w.storeIds, storeOf))
    },
    (err) => {
      for (const w of waiters) w.reject(err)
    },
  )
}

/**
 * Rows grouped by (store, date) summed back to one row per date, the shape a
 * `groupBy: ["date"]` over the same stores returns. A sum over only nulls
 * stays null, as Postgres's SUM does.
 */
export function sumByDate<K extends string>(
  rows: Array<{ date: Date; _sum: Record<K, number | null> }>,
  keys: readonly K[],
): Array<{ date: Date; _sum: Record<K, number | null> }> {
  const byDate = new Map<number, { date: Date; _sum: Record<K, number | null> }>()
  for (const r of rows) {
    const t = r.date.getTime()
    let cur = byDate.get(t)
    if (!cur) {
      cur = { date: r.date, _sum: Object.fromEntries(keys.map((k) => [k, null])) as Record<K, number | null> }
      byDate.set(t, cur)
    }
    for (const k of keys) {
      const v = r._sum[k]
      if (v !== null && v !== undefined) cur._sum[k] = (cur._sum[k] ?? 0) + v
    }
  }
  return [...byDate.values()]
}
