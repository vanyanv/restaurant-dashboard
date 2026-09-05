import { CounterNotFoundClient } from "./not-found/counter-not-found-client"

/**
 * The App Router convention file for a genuine miss anywhere under
 * `/dashboard`, rendering the same client as the real `/dashboard/not-found`
 * route beside it. Two ways in, one page — which is what that route's docblock
 * promised and what the fidelity manifest measures.
 *
 * It lives INSIDE `(counter)` rather than at `src/app/dashboard/` so the
 * reader keeps the rail they need to leave by: `CounterNotFoundClient` offers
 * three destinations, and a 404 rendered outside `(counter)/layout.tsx` would
 * draw them with no chrome and no `.empty` styling around them.
 *
 * It replaces `(editorial)/not-found.tsx` — an `EditorialTopbar` and a
 * "Vol. 01 · A page is missing" masthead — which was the last thing keeping
 * the editorial layout, its cream sidebar and its four stylesheets mounted on
 * any desk route.
 */
export default function DashboardNotFound() {
  return <CounterNotFoundClient />
}
