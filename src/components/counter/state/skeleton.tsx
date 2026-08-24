/**
 * The shape of the page arriving, so a reader knows what is coming before the
 * figures land. Deliberately not a spinner: a spinner says "wait", a skeleton
 * says "here is what you are waiting for".
 */
/**
 * Ten sections each announcing "Loading" would be ten polite live regions on
 * one page, so this deliberately does NOT set `aria-live` — `role="status"`
 * plus `aria-busy` is enough for assistive tech to know the region is busy
 * without every one of them interrupting to say so.
 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-skeleton-row className="flex gap-3">
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
        </div>
      ))}
    </div>
  )
}
