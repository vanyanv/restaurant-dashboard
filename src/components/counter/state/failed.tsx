"use client"

import { useState } from "react"

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
 *
 * Motion. Failing is an operational change (tier 2): the panel rises with the
 * bad cool-down and the mark lands — counter-repairs.css, on `.failed` and
 * `.failed .fi`. Retrying is the reader's own act (tier 4), so it is quiet:
 * `is-retrying` dims the panel to half and disables the button until the
 * section's data comes back, at which point `Section` swaps this component
 * out for the body, and only that body arrives — its chart draws alone while
 * the page around it holds still (D10). On a page whose retry runs through
 * the shared `useCounterTransition`, `Section` shows its skeleton for the
 * pending beat instead (a failed section under `pending` renders as
 * loading), so the dim is seen only on the frame before that transition
 * starts; the arrival that follows is the same either way. The flag never
 * needs clearing: success unmounts this component, and a second failure
 * re-renders it fresh from `SectionData`.
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
  const [retrying, setRetrying] = useState(false)
  return (
    <div className={retrying ? "failed is-retrying" : "failed"} role="alert" aria-busy={retrying}>
      <span className="fi">!</span>
      <div>
        {/*
          * "{title} did not load", not the prototype's "{title} unavailable".
          *
          * Its titles are short nouns; ours are clauses, and the join produced
          * "The figures unavailable" and "What the spend was on unavailable".
          * A verb fixes every one of them at once.
          */}
        <b>{title} did not load</b>
        <p>
          {/*
            * This SECTION only. It said "Everything else on the page is
            * unaffected, and the figures you can see are still good" — a claim
            * about the other sections that this component cannot see and, on
            * 2026-09-02, could not have made: every section on Invoices failed
            * at once, so the page asserted six times over that everything else
            * was fine while nothing was. The reassurance is worth keeping,
            * because a reader who distrusts the whole page abandons it; it is
            * now phrased so it stays true whether one section failed or all of
            * them did.
            */}
          Any figure still showing on this page loaded normally and is good. This section is
          missing, not stale.
        </p>
        <span className="acts">
          {onRetry ? (
            <button
              className="btn"
              type="button"
              disabled={retrying}
              onClick={() => {
                setRetrying(true)
                onRetry(retryAction)
              }}
            >
              {retrying ? "Trying…" : "Try again"}
            </button>
          ) : null}
          <span className="mono">{error}</span>
        </span>
      </div>
    </div>
  )
}
