/**
 * Which phone page a desk path lands on. Moved out of `src/proxy.ts` so the
 * map can be tested on its own: `tests/lib/phone-routes.test.ts` walks every
 * desk navigation entry through `mobilePathFor` and fails when one has no
 * phone page and is not on the `DESK_ONLY` list below.
 */

export const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

export const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/dashboard": "/m",
  "/dashboard/alerts": "/m/alerts",
  "/dashboard/analytics": "/m/analytics",
  "/dashboard/ask": "/m/ask",
  // `/m/ask`, not `/m/chat`: that route is now a shim onto this one. See its
  // page file for the measurement that retired it.
  "/dashboard/chat": "/m/ask",
  "/dashboard/cogs": "/m/cogs",
  // The weekly count and the waste log are phone-first. The report and the
  // setup have no phone page yet; they are on `DESK_ONLY` below.
  "/dashboard/count": "/m/count",
  "/dashboard/count/waste": "/m/count/waste",
  "/dashboard/decisions": "/m/decisions",
  "/dashboard/ingredients": "/m/ingredients",
  "/dashboard/invoices": "/m/invoices",
  // The desk's two list tabs sit under the `[id]` prefix below, so without an
  // exact entry the prefix carried them to `/m/invoices/all` and
  // `/m/invoices/prices`, which the phone resolved as invoice ids and 404'd.
  // The phone's Invoices is already its list; its price monitor lives under
  // Ingredients.
  "/dashboard/invoices/all": "/m/invoices",
  "/dashboard/invoices/prices": "/m/ingredients/prices",
  "/dashboard/labor": "/m/labor",
  "/dashboard/menu": "/m/menu",
  "/dashboard/menu/catalog": "/m/menu/catalog",
  "/dashboard/operations": "/m/operations",
  "/dashboard/operations/inventory": "/m/operations/inventory",
  // Built on Counter with phone surfaces of their own, and unreachable from
  // their desk URL until they were listed here — the same lag Analytics, COGS
  // and Ask each had. Found by the fidelity suite's own landing assertion:
  // the mobile projects asked for the desk path and stayed on it, which is a
  // phone user following a shared link onto the desktop page.
  "/dashboard/operations/inventory/counts": "/m/operations/inventory/counts",
  "/dashboard/operations/packaging": "/m/operations/packaging",
  "/dashboard/operations/product-usage": "/m/operations/product-usage",
  "/dashboard/operations/vendors": "/m/operations/vendors",
  // Stores was deleted from mobile in the bloat sweep and the comment below
  // still said so; `/m/stores` was rebuilt on Counter since, so the desk path
  // maps again. The two sub-paths (`/stores/<id>`, `/stores/new`) have no
  // phone page, so this is an EXACT entry and not a dynamic base.
  "/dashboard/stores": "/m/stores",
  "/dashboard/orders": "/m/orders",
  "/dashboard/pnl": "/m/pnl",
  // Menu Profit now HAS a phone surface of its own, built on Counter from the
  // same adapter the desk uses, so it points there rather than at
  // /m/product-mix. That mapping was a stand-in from when the phone's only
  // menu-performance view was the pre-Counter Product Mix page; the retired
  // desktop /dashboard/product-mix keeps pointing at it for bookmarks until
  // that page is rebuilt in turn.
  "/dashboard/menu-profit": "/m/menu-profit",
  "/dashboard/product-mix": "/m/product-mix",
  "/dashboard/recipes": "/m/recipes",
  // Monitoring, and a deferral its own pages have since answered. The note
  // below used to say this was "a question for whoever owns it" — whether the
  // phone view is the intended destination for an admin route. Five phone
  // surfaces now exist under /m/monitoring, each built on `MStrip` and `MList`
  // against `P.*.phone()`, which is that question answered by whoever built
  // them. Unreachable from their desk URL until now.
  //
  // All eight monitoring tabs have a phone surface now, each built on `MStrip`
  // and `MList` against `P.*.phone()`. This block used to carry a deferral —
  // whether a phone view is the intended destination for an admin route — and
  // then a shrinking list of the tabs that had no phone page. Both are done.
  "/dashboard/operations/inventory/count/new": "/m/operations/inventory/count/new",
  "/dashboard/admin/monitoring": "/m/monitoring",
  "/dashboard/admin/monitoring/activity": "/m/monitoring/activity",
  "/dashboard/admin/monitoring/cache": "/m/monitoring/cache",
  "/dashboard/admin/monitoring/costs": "/m/monitoring/costs",
  "/dashboard/admin/monitoring/infrastructure": "/m/monitoring/infrastructure",
  "/dashboard/admin/monitoring/ingredient-audit": "/m/monitoring/ingredient-audit",
  "/dashboard/admin/monitoring/ml": "/m/monitoring/ml",
  "/dashboard/admin/monitoring/people": "/m/monitoring/people",
  // Stores had no mobile equivalent left after the mobile bloat deletion, and
  // this comment said so until `/m/stores` was rebuilt on Counter; the desk
  // path is mapped exactly above now. Analytics was in that list until it was
  // rebuilt on Counter with a phone surface of its own; it is mapped above,
  // and so is Ask, which was unmapped for the different reason that /m/ask did
  // not exist until the Counter Ask page was built on both surfaces. COGS was
  // in that list too until this task gave it a phone route of its own — see
  // the entry above.
  //
  // The list is NOT exhaustive of what is unmapped, and monitoring used to be
  // the example here — a phone page with no entry, so a phone landed on the
  // desktop admin view. It is mapped above now; see that block for why the
  // question it was waiting on has been answered.
  // Settings folded into /m/more (profile + sign-out) — map straight there
  // instead of through /m/settings (which itself now just redirects to
  // /m/more) to avoid an unnecessary extra hop.
  "/dashboard/not-found": "/m/not-found",
  // The refusal has a phone composition too — `P.forbidden.phone()` is two
  // sentences and one `.mbtn` where the desk gets a whole section explaining
  // itself. The desk gate sends an owner to `/dashboard/forbidden`; this is
  // what happens when that owner is on a phone.
  "/dashboard/forbidden": "/m/forbidden",
  "/dashboard/settings": "/m/more",
  // Store checks, rebuilt for the phone: the same five tabs and the same
  // clients as the desk, drawn inside the phone shell.
  "/dashboard/checks": "/m/checks",
  "/dashboard/checks/history": "/m/checks/history",
  "/dashboard/checks/checklists": "/m/checks/checklists",
  "/dashboard/checks/crew": "/m/checks/crew",
  "/dashboard/checks/posters": "/m/checks/posters",
}

// Desktop routes with a dynamic sub-path that has a matching mobile page
// (e.g. `/dashboard/orders/[id]` -> `/m/orders/[id]`). Only bases listed
// here get their sub-path carried over; every other desktop route maps
// 1:1 via DESKTOP_TO_MOBILE with no further nesting.
//
// This is deliberately an allowlist, not a generic "any desktop base is a
// prefix" match: several mobile pages (ingredients, menu, operations, ...)
// are flat and have no `[id]`-style route at all, so blindly carrying over
// a sub-path 404s. For those, mobilePathFor returns null and the request is
// left on desktop. (Stores was deleted from mobile entirely — see
// DESKTOP_TO_MOBILE above.)
const DYNAMIC_SUBROUTES: Array<[string, string]> = [
  ["/dashboard/analytics", "/m/analytics"],
  ["/dashboard/cogs", "/m/cogs"],
  ["/dashboard/invoices", "/m/invoices"],
  ["/dashboard/labor", "/m/labor"],
  // Carries /dashboard/menu/catalog/<item> to /m/menu/catalog/<item>. The
  // base itself is mapped exactly above, so this entry only ever matches the
  // item route below it — the one dynamic sub-path Menu has.
  ["/dashboard/menu/catalog", "/m/menu/catalog"],
  // Carries /dashboard/ingredients/<id> to /m/ingredients/<id>, and
  // /ingredients/prices to /m/ingredients/prices. The base is mapped exactly
  // above. `prices` used to need an exception below because it had no phone
  // page; it has one now, and Next resolves the static segment ahead of
  // `[id]`, so the prefix rewrite lands on the right route by itself.
  ["/dashboard/ingredients", "/m/ingredients"],
  // The inventory entry is BACK, and this time it is safe. Its first life
  // carried every sub-path under /dashboard/operations/inventory to
  // /m/operations/inventory/… when only `/counts` had been built on the phone,
  // so `/count/new` and `/counts/<id>` both rewrote onto routes that did not
  // exist — two live 404s, found by the fidelity suite's landing assertion
  // rather than by a report. All three have a phone page now: `/counts` and
  // `/count/new` are EXACT entries above, and `/counts/<id>` is the dynamic
  // one this line carries.
  // Carries /dashboard/stores/<id> to /m/stores/<id>. `/stores` itself is an
  // exact entry above; `/stores/new` has no phone page and is excluded below,
  // because a four-field create form is a desk job.
  ["/dashboard/stores", "/m/stores"],
  ["/dashboard/operations/inventory", "/m/operations/inventory"],
  ["/dashboard/operations/vendors", "/m/operations/vendors"],
  ["/dashboard/orders", "/m/orders"],
  ["/dashboard/pnl", "/m/pnl"],
  ["/dashboard/recipes", "/m/recipes"],
]

/**
 * Desk paths that sit UNDER a `DYNAMIC_SUBROUTES` base and have no phone page
 * of their own. Without this, the base's prefix match carries them onto a
 * mobile route that does not exist — a 404 for a phone user, where staying on
 * the desktop page is at least a page.
 *
 * This is the exception list the old inventory entry needed and never had. An
 * entry here is a page waiting to be built, not a decision: delete it the day
 * the phone surface ships.
 *
 * It is EMPTY, having been emptied twice. The first entry,
 * `/dashboard/ingredients/prices`, went the day `P.prices.phone()` was built.
 * The second, `/dashboard/stores/new`, was added when `/dashboard/stores`
 * joined the list above and removed one session later — it was excluded on the
 * reasoning that "a four-field create form is a desk job", and that was wrong
 * on the evidence: `P.storeedit` has a phone composition, it is two fields
 * here rather than the store file's six, and creating a store is the one thing
 * in this cluster you might do standing in the new building.
 *
 * The mechanism is what matters and it is unchanged: a base goes on the
 * rewrite list when its dynamic child has a phone page, and any SIBLING of
 * that child without one has to be named here or it rewrites onto nothing.
 */
const NO_PHONE_PAGE = new Set<string>([])

export function mobilePathFor(desktopPath: string): string | null {
  if (DESKTOP_TO_MOBILE[desktopPath]) return DESKTOP_TO_MOBILE[desktopPath]
  // Checked BEFORE the prefix scan: an exception only works if it beats the
  // base that would otherwise swallow it.
  if (NO_PHONE_PAGE.has(desktopPath)) return null
  for (const [base, mobileBase] of DYNAMIC_SUBROUTES) {
    if (desktopPath.startsWith(base + "/")) {
      return mobileBase + desktopPath.slice(base.length)
    }
  }
  return null
}

/**
 * The href a phone link should carry for a desk destination: its phone page
 * when one exists, else the desk path itself. A desk-only page still opens
 * with the bottom bar (`AppShell`'s `.ct-deskbar`), so the desk path is a
 * working link, where a guessed `/m/...` path would be a 404.
 */
export function phoneHref(deskHref: string): string {
  return mobilePathFor(deskHref) ?? deskHref
}

/**
 * Desk destinations with no phone page YET. Every entry is a page waiting to
 * be built, and the test that reads this list fails when one is built and
 * left here, as it does when a new desk page arrives without a phone page or
 * a line in this list.
 */
export const DESK_ONLY: ReadonlySet<string> = new Set([
  "/dashboard/shop",
  "/dashboard/shop/orders",
  "/dashboard/shop/products",
  "/dashboard/shop/customers",
  "/dashboard/shop/settings",
  "/dashboard/menu/items",
  "/dashboard/count/report",
  "/dashboard/count/setup",
])
