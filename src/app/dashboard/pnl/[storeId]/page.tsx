import { permanentRedirect } from "next/navigation"

/**
 * `/dashboard/pnl/<id>` — a redirect shim onto `/dashboard/pnl?store=<id>`.
 *
 * The store switcher in the Counter rail deletes this route: a store is a
 * PARAM on one P&L now, not a second page with its own composition, and
 * `?store=` is what `writeCounterParams` writes and `readCounterParams` reads.
 *
 * It survives as a shim, and deleting it outright would be a regression
 * dressed up as a rebuild:
 *
 *   - owners have this URL bookmarked, and it was the only per-store P&L for
 *     the whole life of the editorial dashboard;
 *   - the phone's P&L links to it (`src/app/(mobile)/m/pnl/[storeId]`), as do
 *     the store dossier, the analytics shell and the Overview's own store
 *     cards;
 *   - `revalidatePath("/dashboard/pnl/<id>")` is called from two server
 *     actions, and a path that no route serves revalidates nothing.
 *
 * Phase F removes the shims together, once nothing links to one.
 *
 * NO SESSION CHECK, DELIBERATELY. This resolves to a redirect and nothing
 * else, and `/dashboard/pnl` carries the owner gate a line after the session
 * one — gating here as well would be a second copy of that decision that could
 * drift from it, and it would leak the same information either way. The store
 * id is not validated here for the same reason: `getPnlSections` answers a
 * store the account does not own with the `no_match` empty state, which is a
 * page that explains itself rather than a 404 that does not.
 *
 * `permanentRedirect`, not `redirect`: 308 rather than 307, because this URL
 * is not coming back and a bookmark should be rewritten to the one that is.
 */
export default async function StorePnlRedirect({
  params,
}: {
  params: Promise<{ storeId: string }>
}) {
  const { storeId } = await params
  permanentRedirect(`/dashboard/pnl?store=${encodeURIComponent(storeId)}`)
}
