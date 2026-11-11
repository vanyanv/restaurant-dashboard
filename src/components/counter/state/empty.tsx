import type { EmptyReason } from "@/lib/counter/section-data"

/**
 * One reason per next step (note 23) — seven of them now, not the four this
 * comment described until 2026-09-04. Nothing has traded yet, so there is
 * nothing to fix. A filter matched nothing, so the reader backs out of a dead
 * end. An `all_clear` worklist is empty because the work is done. Rendering
 * them all as "No data" would hide which situation the reader is in — and
 * rendering the third as the second actively misleads, which is why the split
 * exists at all.
 *
 * The four added since are all the same lesson in a different page's words: an
 * empty state must name a step the reader can actually take. `no_delivery` is
 * an invoice page at a one-day window against a several-day delivery cadence —
 * not a dead end, a window shorter than the thing it watches.
 * `nothing_received`, `nothing_to_count` and `no_stores` were each split off
 * `no_match` because "widen the filters and date range" was unfollowable on a
 * page with no filters, no date control, or no stores to filter.
 */
const COPY: Record<EmptyReason, { head: string; body: string }> = {
  select_store: {
    head: "Pick a store",
    body: "Choose a store at the top of the page to see its inventory.",
  },
  /*
   * "No sales have been rung up", not "This store has no sales".
   *
   * Every reason in this map is written once and read by every page, at every
   * scope — and `pre_open` is reached from a SCOPE, not from a store: each
   * adapter resolves it with `!scope.some(isOperational)`, so an account whose
   * two stores are both in fit-out gets it at "All stores". Measured on
   * 2026-09-04, `/dashboard/labor` at that scope printed "This store has no
   * sales" ten times down one page while the masthead beside it read "ALL
   * STORES · 2 LOCATIONS". The singular was not a small infelicity there; it
   * was the page naming the wrong subject.
   *
   * `Empty` takes a reason and nothing else, on purpose, so the fix is a
   * sentence true at either number rather than a store count threaded through
   * every adapter. "Trading has not started" is the same reassurance the old
   * copy carried — nothing is broken, there is simply no trade yet — with no
   * claim about how many stores are in scope.
   */
  pre_open: {
    head: "Not trading yet",
    body: "No sales have been rung up, because trading has not started. Figures appear here once it does.",
  },
  no_match: {
    head: "Nothing in this range",
    body: "Try a longer date range or fewer filters.",
  },
  no_delivery: {
    head: "No delivery in this window",
    body:
      "Deliveries come every few days, so a short range is often empty. Try a longer " +
      "range to see what was bought.",
  },
  nothing_received: {
    head: "No invoices received",
    body:
      "Nothing has arrived in the window this page watches. New invoices appear here as " +
      "they are received.",
  },
  nothing_to_count: {
    head: "Nothing to count yet",
    body:
      "A count sheet is built from the ingredient catalogue, and there is nothing in it yet.",
  },
  no_stores: {
    head: "No stores yet",
    body: "Every figure in this product belongs to a store. Add the first one to begin.",
  },
  no_ingredients: {
    head: "The catalogue is empty",
    body:
      "Ingredients come from your invoice lines, so this fills as invoices arrive. " +
      "None have been read in yet.",
  },
  verdict_carried_it: {
    head: "It is all in the verdict",
    body:
      "The one thing this week turns on is the sentence at the top of this page. Nothing " +
      "else came up worth a second line.",
  },
  no_reviews: {
    head: "No reviews yet",
    body:
      "Guest ratings arrive with the order sync from the delivery platforms. Nobody has " +
      "left one yet.",
  },
  no_recipes: {
    head: "No recipes yet",
    body:
      "A recipe gives a menu item its cost. Start one from Menu items.",
  },
  /*
   * The thirteenth, and the only one whose next step is OURS rather than the
   * reader's.
   *
   * Sales and hours come from two different syncs. When the sales half has run
   * and the labour half has not, every figure with hours underneath it — sales
   * per labor hour, labour percent, prime cost — is not missing because the
   * restaurant did nothing; it is missing because the rows have not been
   * pulled. `no_match` would tell an owner to widen a date range that is
   * already right, which is the same unfollowable advice `no_delivery` was
   * split off to stop.
   */
  no_labor_synced: {
    head: "Labor has not synced",
    body:
      "Sales are in, but hours from Harri haven't arrived yet. This fills in after the " +
      "next Harri sync.",
  },
  /*
   * One of the few whose next step is partly OURS rather than the reader's.
   *
   * "What you will run out of" projects an ANCHORED quantity forward: the last
   * completed `StockCount`, plus deliveries, less what the recipes say was
   * used. With no completed count there is no anchor, and a cover figure taken
   * from a zero base would announce a stockout every week for something
   * sitting on the shelf. `no_ingredients` would be the wrong advice — the
   * catalogue is usually fine; it is the count that has never been finished.
   */
  no_counts: {
    head: "Nothing has been counted yet",
    body:
      "This needs one finished stock count to know what's on the shelf. Finish a count " +
      "and it fills in.",
  },
  all_clear: {
    head: "Nothing needs you",
    body: "Every line here is accounted for. This section fills up when something needs a decision.",
  },
}

/**
 * Ported from `bodyEmpty(title)` at line ~2960 of
 * `docs/counter/counter-prototype.html`:
 *
 *   <div class="empty"><span class="t">…</span><span class="s">…</span>
 *                      <button class="btn">…</button></div>
 *
 * `.empty` is `padding:46px 20px` in its own right, which is why `Section`
 * renders this WITHOUT a `.sec__body` around it — the prototype's `sec()` does
 * the same, and wrapping it would inset a tall centred state a second time.
 *
 * The prototype's third child, a `.btn` ("Clear filters" / "Open the store
 * file"), is deliberately not ported. In the prototype both are demo
 * navigations; here `Empty` has no filter model to clear and no route to open,
 * and this codebase does not ship a control that does nothing (see `Failed`).
 * It comes back the day this component is given something to do.
 */
export function Empty({ reason }: { reason: EmptyReason }) {
  const { head, body } = COPY[reason]
  return (
    <div className="empty">
      <span className="t">{head}</span>
      <span className="s">{body}</span>
    </div>
  )
}
