import type { EmptyReason } from "@/lib/counter/section-data"

/**
 * Four reasons, four different next steps (note 23). A pre-open store has no
 * sales because it has no customers — nothing is broken and there is nothing to
 * fix. A filter that matched nothing is a dead end the reader backs out of. An
 * `all_clear` worklist is empty because the work is done. Rendering them all as
 * "No data" would hide which situation the reader is in — and rendering the
 * third as the second actively misleads, which is why it exists. `no_delivery`
 * is the fourth and was added for the same reason: an invoice page at a
 * one-day window is not a dead end a reader should back out of, it is a window
 * shorter than the thing it is watching. Telling them to widen "filters" a
 * purchasing page does not have was advice they could not take.
 */
const COPY: Record<EmptyReason, { head: string; body: string }> = {
  pre_open: {
    head: "Not trading yet",
    body: "This store has no sales because it has no customers yet. Figures appear here once it opens.",
  },
  no_match: {
    head: "Nothing matched",
    body: "No rows fall inside the current filters and date range. Widen either to see figures.",
  },
  no_delivery: {
    head: "No delivery in this window",
    body:
      "Invoices arrive every few days, so a short window is often empty — nothing is " +
      "missing. Widen the range to see what was bought.",
  },
  nothing_received: {
    head: "No invoices received",
    body:
      "Nothing has arrived in the window this page watches. New invoices appear here as " +
      "they are received.",
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
