/**
 * One section failed; the rest of the page is untouched and its figures are
 * still good. That is how this app already behaves, and saying so is the
 * difference between a page a reader still trusts and one they abandon.
 *
 * `retryAction` is a name rather than a function so a SectionData can cross the
 * server/client boundary. The client component that renders a Section maps the
 * name to a handler and passes `onRetry`; without one, no control is offered,
 * because a button that does nothing is worse than no button.
 */
export function Failed({
  error,
  retryAction,
  onRetry,
}: {
  error: string
  retryAction: string
  onRetry?: (action: string) => void
}) {
  return (
    <div role="alert" className="rounded-ct border border-ct-bad/40 bg-ct-bad-wash p-4">
      <p className="text-ct-body text-ct-ink">
        This section failed to load. Everything else on the page is unaffected, and the figures you
        can see are still good.
      </p>
      <p className="mt-1 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">{error}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={() => onRetry(retryAction)}
          className="mt-3 rounded-ct-sm border border-ct-line-strong px-3 py-1.5 text-ct-cap text-ct-ink hover:bg-ct-sunk"
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}
