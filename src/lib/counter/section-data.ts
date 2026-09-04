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
 * One reason per next step (note 23) — nine of them now, not the four this
 * comment counted until 2026-09-04.
 *
 * A pre-open store has no sales because it has no customers — nothing is wrong
 * and there is nothing to do. A filter that matched nothing is a dead end the
 * reader can back out of.
 *
 * `no_delivery` is the fourth, and it is the one the invoice-driven pages
 * needed. Vendors, Packaging and the vendor detail are all about what was
 * BOUGHT, and buying happens every few days — Vendors' own strip prints
 * "delivers every 2.0d". Their default window is one day, so most days they
 * render nothing, and what they rendered was `no_match`: four identical panels
 * reading "No rows fall inside the current filters and date range. Widen
 * either to see figures." on a page that HAS NO FILTERS. Half the advice was
 * unfollowable and the true cause — the window is shorter than the delivery
 * cadence — was never stated.
 *
 * `all_clear` is the third, and it was added because "Needs you" on an order
 * with nothing wrong rendered `no_match`'s copy: *"No rows fall inside the
 * current filters and date range. Widen either to see figures."* — on a page
 * that has no filters and no date range. Worse than clumsy: it tells a reader
 * whose order is perfectly fine to go looking for something they cannot find.
 * An empty worklist is GOOD NEWS and has to read as good news.
 */
export type EmptyReason =
  | "pre_open"
  | "no_match"
  | "all_clear"
  | "no_delivery"
  | "nothing_received"
  | "nothing_to_count"
  | "no_stores"
  | "no_ingredients"
  | "no_recipes"

/*
 * `nothing_received` is the fifth, and it exists because `no_delivery`'s advice
 * does not reach the Invoices page.
 *
 * That page's strip and list are built from a FIXED trailing 30 days rather
 * than the reader's range — deliberately, and the module says why: "a
 * range-bound invoice page would open empty most mornings". So its `isEmpty`
 * asks whether thirty days held anything, and "Widen the range to see what was
 * bought" moves a control that does not govern the answer. That is the same
 * fault `no_delivery` was added to fix, one step further in: advice the reader
 * can follow and still not change what they see.
 *
 * It therefore states the window's result and instructs nothing.
 *
 * `nothing_to_count` is the sixth, and it is the same fault a third time.
 * "Start a count" builds its sheet from the ingredient catalogue — its
 * `isEmpty` is `canonicals.length === 0` — and it carries NO filter row and no
 * date control at all. So "No rows fall inside the current filters and date
 * range. Widen either to see figures." named two things the page does not
 * have, on all three of its sections at once, when the real answer is that
 * there is nothing in the catalogue to put on a sheet.
 *
 * `no_stores` is the seventh, on the same page family and for the same reason:
 * `/dashboard/stores` has no filter row and no date control either — it is in
 * `route-shape`'s own NO_WINDOW list, "a LIST OF THINGS THAT ARE, not a period
 * of trading". An account that has not added its first store is the one state
 * that page exists to get someone out of, and it met them with "Widen either
 * to see figures."
 *
 * `no_ingredients` and `no_recipes` are the eighth and ninth, and they are the
 * sharpest version of the same fault, because on these two pages the advice is
 * not merely unfollowable — it is provably false. Both adapters decide
 * emptiness on a count that NO control on the page can move:
 * `loadIngredients` asks `COUNT(*) FROM "CanonicalIngredient" WHERE
 * "accountId" = …` and `loadRecipes` asks `recipe.findMany({ where: {
 * accountId } })`. Neither takes the range or the store scope. So a reader who
 * did as they were told — widen the date range, widen the store filter — would
 * watch seven panels on Ingredients and four on Recipes say exactly the same
 * thing again, and reasonably conclude the product is broken.
 *
 * They are two reasons rather than one because the next step differs, which is
 * this union's whole test. The catalogue fills from invoice lines, so the
 * ingredient answer is that no invoice has been read yet. A recipe is built
 * against a menu item, so the recipe answer points at the menu.
 */

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

/**
 * What a page may hand a `Section`: the resolved thing, or the promise of it.
 *
 * Task 3 of the streaming-architecture plan. A page used to `await` its whole
 * adapter and hand one finished record to one client component, so the strip
 * could not paint until the chart's query came back. Now an adapter hands back
 * a record of PROMISES, a page passes each one straight through, and `Section`
 * unwraps it inside its own Suspense boundary — so a section waits for its own
 * query and for nothing else.
 *
 * The union keeps the resolved form because two of the eight Counter pages
 * genuinely have nothing to stream: `/dashboard/orders/[id]` and its phone
 * twin build all seven of their sections from ONE `getOrderDetail` load, and
 * both read the head and the platform rows synchronously to title the page.
 * Splitting one query into seven promises that resolve in the same tick would
 * be a picture of streaming rather than streaming. They pass resolved
 * `SectionData` and every other page passes promises, through one prop.
 *
 * It is NOT a status branch and cannot become one: nothing here reads
 * `.status`, and a page still has no way to ask what state its data is in.
 */
export type SectionSource<T> = SectionData<T> | Promise<SectionData<T>>

/**
 * Is this the promise half of a `SectionSource`?
 *
 * Duck-typed on `.then` rather than `instanceof Promise` on purpose: what a
 * client component receives across the RSC boundary is React's own thenable,
 * not necessarily a native `Promise`, and `instanceof` is false for it.
 */
export function isPendingSource<T>(source: SectionSource<T>): source is Promise<SectionData<T>> {
  return typeof (source as { then?: unknown } | null)?.then === "function"
}
