"use client"

import { useEffect } from "react"
import { Failed } from "@/components/counter/state/failed"
import { logger } from "@/lib/logger"

/**
 * A whole Counter ROUTE failed, rather than one section in it.
 *
 * ## Why this exists at all
 *
 * `Section` already renders every section-level failure: `classify()` never
 * throws, so a query that times out becomes a `failed` section and the rest of
 * the page keeps its figures. That covers LOAD failures, which is why the gap
 * this fills stayed invisible for so long.
 *
 * What it does not cover is a RENDER failure inside a page's client island — a
 * cell handed a shape it did not expect, an undefined access on an edge-case
 * row. That escapes `Section` entirely, and before the two `error.tsx` files
 * that use this component, it escaped the `(counter)` groups too: neither had
 * one, so all 42 rebuilt pages fell through to `src/app/global-error.tsx`.
 * Three things went wrong there at once. That boundary replaces the whole
 * document, so the rail, the topbar and the store switcher vanished and the
 * reader had no way out but the back button. Its message — "This is a failure
 * in the application shell, not in one report" — was the exact opposite of the
 * truth. And it is painted in the pre-Counter cream-and-serif palette with no
 * dark theme, so a dark-mode reader got a bright cream page.
 *
 * ## Why it lives in `surface/`
 *
 * `state/` is private to `surface/` — `tests/components/counter/boundary.test.ts`
 * fails any file outside those two that imports `counter/state/`, so that a
 * page cannot reach a state component directly and re-implement state
 * handling. An `error.tsx` is a route file, so this wrapper sits in `surface/`
 * and is re-exported from the barrel, and the boundaries import it the way a
 * page imports anything else. The rule is kept, not excepted.
 *
 * ## Why it reuses `Failed`
 *
 * `Section` is the sole state renderer, and "this did not work" already has a
 * rendering. A second one would be the drift that rule exists to prevent —
 * and this way a route failure looks like a section failure, which is honest:
 * from the reader's side the difference is only how much of the page it took.
 *
 * The boundary sits INSIDE the route group, so `(counter)/layout.tsx` still
 * renders. The shell survives and the rail still navigates — which is the
 * whole reason to have it here rather than at the root.
 */
export function RouteFailed({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** Names the surface that failed, the way `Section` names the section. */
  title: string
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // withholds from the client in production. Without it in the log there is
    // nothing to correlate a report against.
    logger.error("[counter] route boundary caught", {
      title,
      digest: error.digest,
      message: error.message,
    })
  }, [error, title])

  return (
    <div className="sec">
      <Failed
        title={title}
        // `error.message` is deliberately not shown in production: Next
        // replaces it with a generic string there anyway, and the digest is
        // what actually identifies the failure in the logs.
        error={error.digest ? `Reference ${error.digest}` : error.message}
        retryAction="retryRoute"
        onRetry={reset}
      />
    </div>
  )
}
