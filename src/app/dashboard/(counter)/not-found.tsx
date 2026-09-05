import { CounterNotFoundClient } from "./not-found/counter-not-found-client"

/**
 * The App Router convention file for `notFound()` thrown anywhere inside
 * `(counter)`, rendering the same client as the real `/dashboard/not-found`
 * route beside it. Two ways in, one page — which is what that route's docblock
 * promised and what the fidelity manifest measures.
 *
 * ## What it actually catches, measured
 *
 * Eleven Counter detail routes call `notFound()` — `invoices/[id]`,
 * `recipes/[id]`, `orders/[id]`, `stores/[id]`, `ingredients/[id]`,
 * `menu/catalog/[item]`, `operations/vendors/[vendor]`,
 * `operations/inventory/counts/[id]` and the three `[storeId]` statements —
 * and every one of them lands here. Verified against the dev server:
 * `/dashboard/invoices/nonexistent-id-xyz` and `/dashboard/recipes/nope-123`
 * both render `.empty`, three `.btn` links and the rail. That is the 404
 * people actually hit: a bookmark to a record that has since been deleted.
 *
 * IT DOES NOT CATCH AN UNMATCHED URL, and no file inside a route group can.
 * `/dashboard/bogus-page` resolves into no group, so Next never enters
 * `(counter)` and falls through to the root `src/app/not-found.tsx` — still
 * the editorial "missing dispatch" page. That is unchanged behaviour, not a
 * regression: `(editorial)/not-found.tsx`, which this replaces, sat inside a
 * route group too and was unreachable for exactly the same reason. Fixing it
 * means a `src/app/dashboard/not-found.tsx`, which renders OUTSIDE
 * `(counter)/layout.tsx` and so cannot use this client — `usePageChrome` and
 * `.empty` both want the shell. Left for whoever rebuilds the root 404, which
 * is shared with `/login`, `/signup` and every signed-out path.
 *
 * It lives inside `(counter)` rather than at `src/app/dashboard/` so the
 * reader keeps the rail they leave by: this page offers three destinations,
 * and drawn outside the shell they would have no chrome and no styling.
 */
export default function CounterNotFound() {
  return <CounterNotFoundClient />
}
