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
    return failed<T>(
      err instanceof Error ? err.message : "Something went wrong loading this section",
      opts.retryAction,
    )
  }
}
