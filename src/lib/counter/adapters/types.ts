import {
  empty, failed, notComputed, ready, stale,
  type EmptyReason, type SectionData,
} from "@/lib/counter/section-data"

/**
 * What every Counter page adapter returns.
 *
 * An adapter is the ONLY new server code a page needs. It calls the actions
 * and library functions that already exist, and its entire job is to classify
 * each result into one of the six states. Everything downstream — the six
 * renderings, the retry, the em-dashes — is already built.
 *
 * `npm run tokens` forbids a page from importing Prisma or an action directly,
 * and from inspecting `SectionData.status`. This is where both of those live
 * instead.
 */
export type PageSections = Record<string, SectionData<unknown>>

export interface ClassifyOptions<T> {
  /** A name a client can map to a handler. Not a function — a SectionData must stay serialisable. */
  retryAction: string
  /** When set, the loader is never called and the section reports owed work. */
  owed?: string
  isEmpty?: (value: T) => boolean
  /** Which empty. A pre-open store is not a filter that matched nothing. */
  emptyReason?: EmptyReason
  /** When the last successful sync ran, if the current one failed. */
  staleSince?: Date
}

/**
 * Runs one loader and classifies its outcome. It NEVER throws: a section that
 * fails becomes a `failed` section, and the rest of the page renders with every
 * figure that did load. A page that 500s because one query timed out throws
 * away good numbers the reader could have used.
 */
/**
 * Raw database noise, which a reader must never be shown.
 *
 * `Failed` prints this string under the section, and it used to print
 * `err.message` whole. During the 2026-09-02 outage that put
 * "Invalid `prisma.store.findMany()` invocation: Server has closed the
 * connection." on an owner's Invoices page six times over — the ORM's name,
 * its method, and a fact about a connection pool, in front of someone who
 * runs a restaurant.
 */
const DB_NOISE =
  /Invalid `prisma\.|Can't reach database server|Server has closed the connection|Connection terminated|ECONNREFUSED|ETIMEDOUT|too many connections|Timed out fetching a new connection/i

/**
 * What the reader is told a failure was.
 *
 * A message an ADAPTER wrote — "Otter sync timed out" — is written for this
 * slot and passes through, which is the whole reason the slot carries a real
 * error rather than the prototype's hardcoded "timed out after 8s". A message
 * the DATABASE wrote was written for a log, so it stays in the log: Prisma is
 * already configured to print it there, and what reaches the page is the one
 * fact a reader can act on.
 */
function readerReason(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong loading this section"
  return DB_NOISE.test(err.message) ? "The database did not answer" : err.message
}

export async function classify<T>(
  load: () => T | Promise<T>,
  opts: ClassifyOptions<T>,
): Promise<SectionData<T>> {
  // Owed work short-circuits BEFORE the loader runs. A section nobody has
  // built yet must not pay for a query to prove it.
  if (opts.owed !== undefined) return notComputed<T>(opts.owed)

  try {
    const value = await load()

    if (opts.isEmpty?.(value)) return empty<T>(opts.emptyReason ?? "no_match")
    if (opts.staleSince) return stale(value, opts.staleSince)
    return ready(value)
  } catch (err) {
    return failed<T>(readerReason(err), opts.retryAction)
  }
}

/**
 * An adapter's streaming return: the same record of sections, one promise per
 * key.
 *
 * This is the shape Task 3 of the streaming-architecture plan turns on. The
 * awaited `getXSections` still exists — every test and the two order-detail
 * pages use it — but it is now a thin `awaitSections()` over the streaming
 * variant, so there is exactly ONE piece of code deciding what each section
 * holds. Two implementations of "what is in the strip" is how two surfaces
 * come to print two different numbers for one day.
 */
export type StreamedSections<S> = { [K in keyof S]: Promise<S[K]> }

/**
 * What a page CLIENT accepts: either half of `SectionSource`, per key.
 *
 * A client island is typed on this rather than on `StreamedSections` so the
 * same island renders identically whether the page streamed its sections or
 * resolved them first — which is what keeps every existing island test, all of
 * which hand over plain `ready()` values with no promise anywhere, meaningful.
 */
export type SectionSources<S> = { [K in keyof S]: S[K] | Promise<S[K]> }

/**
 * The streaming record, awaited back into a plain one.
 *
 * `Promise.all` over the values, so this costs exactly what awaiting the
 * adapter always cost: the slowest section. Nothing here changes what a
 * section holds.
 */
export async function awaitSections<S extends object>(
  streamed: StreamedSections<S>,
): Promise<S> {
  const keys = Object.keys(streamed) as Array<keyof S>
  const values = await Promise.all(keys.map((k) => streamed[k]))
  const out = {} as S
  keys.forEach((k, i) => {
    out[k] = values[i] as S[typeof k]
  })
  return out
}

/**
 * The last-resort guard on a streamed section: a rejection becomes a `failed`
 * section instead of a page.
 *
 * `classify` already promises never to throw, and every loader goes through
 * it. What is new in the streaming shape is the SECOND half of a section —
 * the `mapReady(...)` that turns a loaded rollup into cells — which now runs
 * inside a promise rather than inside the page's own `await`. Before Task 3 a
 * builder that threw took the whole page down with a 500; unguarded here it
 * would instead reject a promise that a client component is about to `use()`,
 * which React reports as an unhandled error on the nearest boundary — a
 * blank page with a worse explanation.
 *
 * So every section promise an adapter returns is wrapped in this. It also
 * means no adapter can hand back a promise nothing is listening on, which is
 * what an unhandled rejection warning at request time actually is.
 */
export function guardSection<T>(
  promise: Promise<SectionData<T>>,
  retryAction: string,
): Promise<SectionData<T>> {
  return promise.catch((err: unknown) =>
    failed<T>(
      err instanceof Error ? err.message : "Something went wrong building this section",
      retryAction,
    ),
  )
}
