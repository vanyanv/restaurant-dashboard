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
 * for the same page (`src/proxy.ts` redirects on a phone user agent).
 */
const RECORD_ROUTES: readonly { readonly match: RegExp; readonly list: string }[] = [
  { match: /^\/dashboard\/orders\/[^/]+\/?$/, list: "/dashboard/orders" },
  { match: /^\/m\/orders\/[^/]+\/?$/, list: "/m/orders" },
]

function recordRoute(pathname: string) {
  return RECORD_ROUTES.find((r) => r.match.test(pathname)) ?? null
}

/**
 * The prototype's `nodate`, which is WIDER than "this is a record".
 *
 * `P.<page>.nodate` turns off `CD.chip()` in `phoneFor()` and `CD.bar()` on
 * the desk, and eleven pages carry it. Two of them are records (an order, an
 * invoice) and the rest are not: Stores, the store file, New store, Start a
 * count, a count session, More, Settings, and the two doors — pages whose
 * subject is a LIST OF THINGS THAT ARE, not a period of trading. There is no
 * window over "which stores exist" to widen or compare, so the control was
 * drawn on every one of them and changed nothing, which is note 46 exactly
 * ("a control that is drawn and does nothing").
 *
 * Phone paths only. The desk draws the same control from the same flag and
 * has the same surplus on the same pages; correcting it there is a change to
 * routes this pass has not looked at, so it is left named here rather than
 * made silently.
 */
const NO_WINDOW_ROUTES: readonly RegExp[] = [
  /^\/m\/more\/?$/,
  /^\/m\/settings\/?$/,
  /*
   * `/m/stores` and `/m/stores/new`, but NOT `/m/stores/<id>`.
   *
   * The prototype draws no chip on the store file either, and that is an
   * ARTEFACT rather than a decision: `.mtop` reads `p.nodate` where `p` is the
   * HOST page, the store file is a view of Stores, and Stores is `nodate`.
   * `P.storecosts` itself sets none, which is why the DESK draws the bar on
   * it — and the page needs it. Every fixed cost on that screen is prorated to
   * the selected range and its strip's second cell is literally "this range",
   * so removing the only control that changes it makes the figure a claim
   * about a window the reader cannot see or move. Note 42, in reverse.
   */
  /^\/m\/stores(\/new)?\/?$/,
  /^\/m\/invoices\/[^/]+\/?$/,
  /^\/m\/operations\/inventory\/counts\/[^/]+\/?$/,
  /*
   * `/m/operations/inventory/count/new` is NOT here, and `P.countnew` does
   * carry `nodate: true`. The prototype rewrites every link to a view child
   * into its host plus a tab, so Start a count renders as `phoneFor('inventory')`
   * and it is INVENTORY'S flag the chip reads — checked against the rendered
   * frame, which draws "Aug 15 – 21, 2026" on it. Counts is the same case, and
   * for the same reason is also absent. A tab does not change the window.
   */
  /^\/m\/forbidden\/?$/,
  /^\/m\/not-found\/?$/,
]

/**
 * Does this route have a date window? False on a record route and on the
 * pages above, and the two things that turn off with it are the ⌘K palette's
 * "Change the range" group and the phone's `.mtop` date chip.
 */
export function hasWindow(pathname: string): boolean {
  if (recordRoute(pathname) !== null) return false
  return !NO_WINDOW_ROUTES.some((r) => r.test(pathname))
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
 * The DESK route a phone route is the phone of — `/m/analytics` →
 * `/dashboard/analytics`, `/m` → `/dashboard`.
 *
 * `NAV_GROUPS` is written in desk hrefs (it is the desk's rail), so anything
 * that resolves a route to a nav destination — `Topbar`'s crumb,
 * `describeAskContext`'s subject — resolves nothing at all when handed a `/m`
 * pathname. That is how the phone's Ask would have prepended "Answering about
 * Dashboard" to a question asked from Analytics.
 *
 * A RULE, not a table, and deliberately: `src/proxy.ts` maps a desk path
 * to a phone path by keeping the segment name (`/dashboard/x` → `/m/x`) for
 * every route where both exist, so the inverse is the same rule read
 * backwards. The three that do NOT follow it — `/dashboard/settings` → `/m/more`,
 * `/dashboard/menu-profit` → `/m/product-mix`, `/dashboard/admin/monitoring`
 * → `/m/monitoring` — come back as `/dashboard/more`, `/dashboard/product-mix`
 * and `/dashboard/monitoring`, none of which is a nav destination, so they
 * resolve to NOTHING rather than to the wrong page. That is the same trade
 * `describeAskContext` already makes with its untrusted `?asked=`: a value it
 * cannot match is dropped, never guessed at.
 */
export function deskRouteFor(pathname: string): string {
  if (pathname === "/m") return "/dashboard"
  if (pathname.startsWith("/m/")) return `/dashboard/${pathname.slice("/m/".length)}`
  return pathname
}

/**
 * `trailOf()` for the phone's `.mback`. A root tab has no trail and gets no
 * back button — a back button to nowhere is the same defect as a chevron to
 * nowhere.
 *
 * This carried ONE route (`/m/orders/<id>`), so eleven phone screens that the
 * design gives a back button had none. Read off the prototype rather than
 * guessed: `trailOf()` is run for all 53 pages and the rendered `.mback` label
 * recorded, which is the list below.
 *
 * ## Why a table and not the prototype's own derivation
 *
 * `PARENT` (prototype line 8145) derives the trail by walking a route string
 * up a segment at a time until it finds another page. Ported literally that
 * rule is WRONG here, and one pair shows why:
 *
 *     /m/ingredients/<id>     back -> Ingredients
 *     /m/ingredients/prices   back -> nothing
 *
 * Both sit one segment under `/m/ingredients` and they differ because Prices
 * is a VIEW of Ingredients — the prototype rewrites a link to a view child
 * into its host plus a tab, so `prices` is never a page you arrived at, it is
 * a tab you pressed, and a tab does not get a back button. Ours are real
 * routes (see `nav.ts`: "a route you cannot bookmark is not a route"), so the
 * distinction the prototype gets from `VIEWOF` has to be stated. The same is
 * true of Counts under Inventory, Packaging under Vendors, and Mix under Menu.
 *
 * The label is the parent's name as the prototype draws it, which is not
 * always the parent's page title: `/m/operations/inventory/counts/<id>` goes
 * back to "Stock counts", the name that page carries in `NAVNAME`.
 */
const PHONE_TRAILS: readonly {
  readonly match: RegExp
  readonly href: string
  readonly label: string
}[] = [
  // Record routes: one thing that happened, and the list it came from.
  { match: /^\/m\/orders\/[^/]+\/?$/, href: "/m/orders", label: "Orders" },
  { match: /^\/m\/invoices\/[^/]+\/?$/, href: "/m/invoices", label: "Invoices" },
  { match: /^\/m\/recipes\/[^/]+\/?$/, href: "/m/recipes", label: "Recipes" },
  { match: /^\/m\/ingredients\/(?!prices\/?$)[^/]+\/?$/, href: "/m/ingredients", label: "Ingredients" },
  { match: /^\/m\/menu\/catalog\/[^/]+\/?$/, href: "/m/menu/catalog", label: "Menu catalog" },
  {
    match: /^\/m\/operations\/inventory\/counts\/[^/]+\/?$/,
    href: "/m/operations/inventory/counts",
    label: "Stock counts",
  },
  {
    match: /^\/m\/operations\/vendors\/[^/]+\/?$/,
    href: "/m/operations/vendors",
    label: "Vendors",
  },
  // The three Operations children. Inventory and Vendors are pages under it;
  // their own view tabs (Counts, Start a count, Packaging) inherit the same
  // parent, because a tab does not change which page you are on.
  {
    match: /^\/m\/operations\/(inventory|vendors|packaging)(\/(counts|count\/new))?\/?$/,
    href: "/m/operations",
    label: "Operations",
  },
]

export function phoneTrail(pathname: string): { href: string; label: string } | null {
  const hit = PHONE_TRAILS.find((t) => t.match.test(pathname))
  return hit ? { href: hit.href, label: hit.label } : null
}
