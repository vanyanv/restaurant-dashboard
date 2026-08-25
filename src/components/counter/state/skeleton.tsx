/**
 * The shape of the page arriving, so a reader knows what is coming before the
 * figures land. Deliberately not a spinner: a spinner says "wait", a skeleton
 * says "here is what you are waiting for".
 *
 * Ported from `bodyLoading()` / `skRow()` at line ~2947 of
 * `docs/counter/counter-prototype.html`: four `.skb-row`s, each holding four
 * `.skb.skb-line` spans. `.skb-row` is the 1.6fr/1fr/1fr/1fr grid that makes
 * the placeholder read as a table rather than as four equal bars, and `.skb`
 * carries the shimmer — neither is anything Tailwind can approximate, and both
 * are already in `counter-components.css`.
 *
 * Ten sections each announcing "Loading" would be ten polite live regions on
 * one page, so this deliberately does NOT set `aria-live` — `role="status"`
 * plus `aria-busy` is enough for assistive tech to know the region is busy
 * without every one of them interrupting to say so. The wrapper that carries
 * them is our own addition (the prototype emits the four rows bare) and is
 * unclassed, so it inherits `.sec__body`'s block flow and changes nothing:
 * `.skb-row:last-child{border-bottom:none}` still resolves against it.
 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-skeleton-row className="skb-row">
          <span className="skb skb-line" />
          <span className="skb skb-line" />
          <span className="skb skb-line" />
          <span className="skb skb-line" />
        </div>
      ))}
    </div>
  )
}
