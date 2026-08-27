/**
 * What SHAPE a Counter route is, read off the route string alone.
 *
 * Note 48 again — "the route strings already knew the way." `Topbar` already
 * derives its parent crumb from `pathname` against `NAV_GROUPS`, and `Rail`
 * lights its current item the same way. These two facts are the rest of what
 * the chrome needs once it lives in a layout instead of in each page:
 *
 *   1. whether the page has a WINDOW at all, and
 *   2. where "pick a store" should go when it does not.
 *
 * Both were page props before the chrome moved (`presetId` / `onSelectPreset`
 * omitted by the order island, `goToStoreList` written out by it). Derived
 * here they are known during the FIRST render, on the server — which matters,
 * because the phone's date chip sits inside the fidelity surface and a control
 * that appears and then vanishes on hydration is worse than one that is simply
 * right. Anything a route string genuinely cannot know goes through
 * `PageChrome` instead.
 */

/**
 * A RECORD route: its subject is one thing that happened at one instant, so
 * there is no range to widen, no comparison to make and nothing for `?range=`
 * to mean. `nodate: true` in the prototype (line 6569).
 *
 * One entry per surface, because the desk and the phone are different routes
 * for the same page (`src/middleware.ts` redirects on a phone user agent).
 */
const RECORD_ROUTES: readonly { readonly match: RegExp; readonly list: string }[] = [
  { match: /^\/dashboard\/orders\/[^/]+\/?$/, list: "/dashboard/orders" },
  { match: /^\/m\/orders\/[^/]+\/?$/, list: "/m/orders" },
]

function recordRoute(pathname: string) {
  return RECORD_ROUTES.find((r) => r.match.test(pathname)) ?? null
}

/**
 * Does this route have a date window? False on a record route, and the two
 * things that turn off with it are the ⌘K palette's "Change the range" group
 * and the phone's `.mtop` date chip — a control that is drawn and does nothing
 * is note 46's defect exactly.
 */
export function hasWindow(pathname: string): boolean {
  return recordRoute(pathname) === null
}

/**
 * Where picking a store goes. On a page scoped by `?store=` that is the page
 * itself; on a record route, selecting a store cannot re-scope a page about
 * one order, so it goes to that store's LIST instead — which is the decision
 * both order islands used to write out by hand.
 */
export function storeScopeHref(pathname: string): string {
  return recordRoute(pathname)?.list ?? pathname
}

/**
 * `trailOf()` for the phone's `.mback`. A root tab has no trail and gets no
 * back button — a back button to nowhere is the same defect as a chevron to
 * nowhere.
 */
export function phoneTrail(pathname: string): { href: string; label: string } | null {
  if (/^\/m\/orders\/[^/]+\/?$/.test(pathname)) return { href: "/m/orders", label: "Orders" }
  return null
}
