/**
 * The one shape that crosses every Counter data boundary.
 *
 * Prototype note 22: "States belong in the builders, not the pages." Loading,
 * failed, empty and stale are implemented once inside the surface primitives,
 * which is why all fifty-three pages have all their states without any page
 * author writing one. This union is the mechanism — a page cannot hand a
 * primitive anything else, so it cannot forget a state.
 *
 * Six states, not the prototype's five. `not_computed` is ours: several
 * sections the design calls for have no server code yet, and rendering them as
 * a named piece of owed work is the only honest option that is neither a fake
 * number nor a silent gap.
 */
export type SectionData<T> =
  | { status: "ready"; data: T }
  | { status: "stale"; data: T; lastGoodAt: Date }
  | { status: "loading" }
  | { status: "failed"; error: string; retryAction: string }
  | { status: "empty"; reason: EmptyReason }
  | { status: "not_computed"; owed: string }

/**
 * Three reasons, because they need different next steps (note 23).
 *
 * A pre-open store has no sales because it has no customers — nothing is wrong
 * and there is nothing to do. A filter that matched nothing is a dead end the
 * reader can back out of.
 *
 * `all_clear` is the third, and it was added because "Needs you" on an order
 * with nothing wrong rendered `no_match`'s copy: *"No rows fall inside the
 * current filters and date range. Widen either to see figures."* — on a page
 * that has no filters and no date range. Worse than clumsy: it tells a reader
 * whose order is perfectly fine to go looking for something they cannot find.
 * An empty worklist is GOOD NEWS and has to read as good news.
 */
export type EmptyReason = "pre_open" | "no_match" | "all_clear"

export const ready = <T>(data: T): Extract<SectionData<T>, { status: "ready" }> => ({
  status: "ready",
  data,
})

export const stale = <T>(
  data: T,
  lastGoodAt: Date,
): Extract<SectionData<T>, { status: "stale" }> => ({
  status: "stale",
  data,
  lastGoodAt,
})

export const loading = <T = never>(): Extract<SectionData<T>, { status: "loading" }> => ({
  status: "loading",
})

/**
 * `retryAction` is a name, not a function, so a SectionData stays serialisable
 * across the server/client boundary. The surface component maps the name to a
 * handler; a server component can therefore build one of these directly.
 */
export const failed = <T = never>(
  error: string,
  retryAction: string,
): Extract<SectionData<T>, { status: "failed" }> => ({
  status: "failed",
  error,
  retryAction,
})

export const empty = <T = never>(
  reason: EmptyReason,
): Extract<SectionData<T>, { status: "empty" }> => ({
  status: "empty",
  reason,
})

export const notComputed = <T = never>(
  owed: string,
): Extract<SectionData<T>, { status: "not_computed" }> => ({
  status: "not_computed",
  owed,
})

/**
 * The ONLY status inspection a consumer should need. Surface primitives call
 * this; pages call nothing, because pages never receive a reason to look.
 */
export function hasData<T>(
  sd: SectionData<T>,
): sd is Extract<SectionData<T>, { status: "ready" | "stale" }> {
  return sd.status === "ready" || sd.status === "stale"
}

/** The data a section carries, or null. `hasData` is the sanctioned accessor. */
export function dataOf<T>(sd: SectionData<T>): T | null {
  return hasData(sd) ? sd.data : null
}

/**
 * True when the section LOADED and there was nothing there — and false for
 * every other reason it might be showing no data.
 *
 * The second, narrower status question a consumer can legitimately ask, and it
 * exists for exactly one caller: a DETAIL page. `/dashboard/orders/[id]` is
 * about one record, and an id that does not exist (or belongs to another
 * account) is a 404, not a page of grey panels. `getOrderSections` already
 * encodes that — `classify`'s `isEmpty` turns a null `getOrderDetail` into
 * `empty` — but the page cannot read it through `hasData`, which is equally
 * false for `loading`, `failed` and `not_computed`.
 *
 * THAT DISTINCTION IS THE WHOLE POINT. A page that 404'd on `!hasData` would
 * turn a database outage into "no such order", which is a lie told to the one
 * reader who most needs the truth, and it would do it silently. `empty` means
 * the load succeeded; `failed` means it did not, and a failed section still
 * renders as a failed section on a page that exists.
 *
 * It lives here rather than in a page because `npm run tokens`' no-status-branch
 * rule holds over `src/app/**` .tsx — pages compose, they do not inspect. The
 * check belongs in this module, once, beside `hasData`.
 */
export function isMissing<T>(sd: SectionData<T>): boolean {
  return sd.status === "empty"
}

/**
 * Re-classifies an already-classified `SectionData` through `f`, keeping every
 * non-data status (failed/empty/not_computed/loading) exactly as it was.
 *
 * This is how one query answers eight sections: `f` only ever runs on a value
 * that already loaded, so no adapter needs a status branch of its own and no
 * second load is issued to fill a second section. Lived in
 * `adapters/overview.ts` until the P&L adapter needed the identical pair;
 * moved here rather than copied, because a second copy is a second set of
 * cases to forget one of.
 */
export function mapReady<T, U>(sd: SectionData<T>, f: (value: T) => U): SectionData<U> {
  switch (sd.status) {
    case "ready":
      return ready(f(sd.data))
    case "stale":
      return stale(f(sd.data), sd.lastGoodAt)
    case "failed":
      return failed(sd.error, sd.retryAction)
    case "empty":
      return empty(sd.reason)
    case "not_computed":
      return notComputed(sd.owed)
    case "loading":
      return loading()
  }
}

/**
 * `mapReady`, but the mapper may decide the value is not a section after all —
 * a selected store the rollup has no row for, an account that has never
 * traded. Returning a `SectionData` from `f` lets one loader answer "loaded,
 * and there is nothing here" without a second query.
 */
export function mapReadyTo<T, U>(
  sd: SectionData<T>,
  f: (value: T) => SectionData<U>,
): SectionData<U> {
  if (sd.status === "ready") return f(sd.data)
  if (sd.status === "stale") {
    const next = f(sd.data)
    return next.status === "ready" ? stale(next.data, sd.lastGoodAt) : next
  }
  return mapReady(sd, () => undefined as never)
}
