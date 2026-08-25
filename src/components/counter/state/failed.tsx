/**
 * One section failed; the rest of the page is untouched and its figures are
 * still good. That is how this app already behaves, and saying so is the
 * difference between a page a reader still trusts and one they abandon.
 *
 * Ported from `bodyError(title)` at line ~2953 of
 * `docs/counter/counter-prototype.html`:
 *
 *   <div class="failed">
 *     <span class="fi">!</span>
 *     <div>
 *       <b>{title} unavailable</b>
 *       <p>This section failed to load. …</p>
 *       <span class="acts"><button class="btn">Try again</button>
 *                          <span class="mono">timed out after 8s</span></span>
 *     </div>
 *   </div>
 *
 * `title` comes from `Section`, which is the only thing that knows it — the
 * prototype passes it into `bodyError` for the same reason. Without it the
 * failure says "this section" to a reader who is looking at six of them.
 *
 * `retryAction` is a name rather than a function so a SectionData can cross the
 * server/client boundary. The client component that renders a Section maps the
 * name to a handler and passes `onRetry`; without one, no control is offered,
 * because a button that does nothing is worse than no button. That is the one
 * divergence from the prototype's body, which always draws "Try again" — its
 * button is a mock and ours would have to be too.
 *
 * `.mono` carries the real error where the prototype hardcodes "timed out
 * after 8s". `role="alert"` is ours; the prototype has no assistive layer.
 */
export function Failed({
  title,
  error,
  retryAction,
  onRetry,
}: {
  /** The section that failed, so the message can name it. */
  title: string
  error: string
  retryAction: string
  onRetry?: (action: string) => void
}) {
  return (
    <div className="failed" role="alert">
      <span className="fi">!</span>
      <div>
        <b>{title} unavailable</b>
        <p>
          This section failed to load. Everything else on the page is unaffected, and the figures you
          can see are still good.
        </p>
        <span className="acts">
          {onRetry ? (
            <button className="btn" type="button" onClick={() => onRetry(retryAction)}>
              Try again
            </button>
          ) : null}
          <span className="mono">{error}</span>
        </span>
      </div>
    </div>
  )
}
