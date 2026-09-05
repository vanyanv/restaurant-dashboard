/*
 * Renamed from `src/middleware.ts` for Next 16, which deprecates that file
 * convention — `next build` emits "The \"middleware\" file convention is
 * deprecated. Please use \"proxy\" instead." and already labels this entry
 * `ƒ Proxy (Middleware)` in its route table.
 *
 * Nothing else changed: `withAuth`, the shutdown gate, the phone redirect map
 * and the `config.matcher` export are byte-for-byte what they were. Kept as a
 * pure rename precisely so the shutdown gate — which is live in production
 * and blanks the app for everyone but the OWNER — has an empty diff to read.
 */
import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/dashboard": "/m",
  "/dashboard/alerts": "/m/alerts",
  "/dashboard/analytics": "/m/analytics",
  "/dashboard/ask": "/m/ask",
  // `/m/ask`, not `/m/chat`: that route is now a shim onto this one. See its
  // page file for the measurement that retired it.
  "/dashboard/chat": "/m/ask",
  "/dashboard/cogs": "/m/cogs",
  "/dashboard/decisions": "/m/decisions",
  "/dashboard/ingredients": "/m/ingredients",
  "/dashboard/invoices": "/m/invoices",
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

function mobilePathFor(desktopPath: string): string | null {
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

const shutdownAt = process.env.SERVICE_SHUTDOWN_AT


/**
 * The static half of the legacy map — one old path, one new one.
 *
 * `/dashboard/stores/<id>/edit` and `/dashboard/pnl/<id>` carry an id and are
 * matched below rather than here.
 */
const LEGACY_PATHS: Record<string, string> = {
  "/dashboard/chat": "/dashboard/ask",
  "/dashboard/operations/costs": "/dashboard/menu-profit",
  "/dashboard/operations/recipes": "/dashboard/recipes",
  "/m/settings": "/m/more",
}

/** Where a legacy path goes, or null if it is not one. */
function legacyTargetFor(path: string): string | null {
  const flat = LEGACY_PATHS[path]
  if (flat) return flat

  // `/dashboard/stores/<id>/edit` -> the store file, which carries the form now.
  const edit = /^\/dashboard\/stores\/([^/]+)\/edit$/.exec(path)
  if (edit) return `/dashboard/stores/${edit[1]}`

  // `/dashboard/pnl/<id>` -> `?store=<id>`. A store is a param on one
  // statement, not a second page; see that route's own docblock.
  const pnl = /^\/dashboard\/pnl\/([^/]+)$/.exec(path)
  if (pnl) return `/dashboard/pnl?store=${encodeURIComponent(pnl[1])}`

  return null
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    if (shutdownAt && token?.role !== "OWNER") {
      if (
        path === "/shutdown" ||
        path === "/login" ||
        // The phone's own sign-in page. Without it a shut-down service sends
        // a phone OWNER from /login to /m/login and then rewrites /m/login to
        // /shutdown — locking out the one account the gate exists to let in.
        path === "/m/login" ||
        path === "/shutdown/phone" ||
        path.startsWith("/api/auth/")
      ) {
        return NextResponse.next()
      }
      if (path.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Service shut down", since: shutdownAt },
          { status: 503 }
        )
      }
      // The phone has its own notice — `P.shutdown` is two compositions like
      // every other page, and `.btn` is not `.mbtn`. It lives outside `/m` so
      // it does not inherit the tab bar; see that route's own note.
      const shutUa = req.headers.get("user-agent") ?? ""
      const shutPhone =
        PHONE_UA.test(shutUa) && req.cookies.get("prefer-desktop")?.value !== "1"
      return NextResponse.rewrite(
        new URL(shutPhone ? "/shutdown/phone" : "/shutdown", req.url),
      )
    }

    // API routes were never subject to the auth/mobile logic below; the
    // matcher includes them only so the shutdown gate can cover them.
    if (path.startsWith("/api/")) {
      return NextResponse.next()
    }

    const ua = req.headers.get("user-agent") ?? ""
    const isPhone = PHONE_UA.test(ua)
    const preferDesktop = req.cookies.get("prefer-desktop")?.value === "1"

    /*
     * Sign-in has a phone composition of its own, and this is the ONE rewrite
     * that happens before the public short-circuit below.
     *
     * `P.login` and `P.login.phone()` are two different screens, not one
     * screen at two widths: the desk draws `.btn`s in a two-column grid beside
     * an aside, the phone draws `.mbtn`s in a single column with none of it.
     * A class cannot change with a media query, so one route cannot be both —
     * which is the same reason every other page here is a `/dashboard` route
     * and an `/m` one.
     *
     * `/m/login` is in the public list below and in the shutdown allowlist
     * above, so this cannot loop: a phone asking for /login lands on /m/login,
     * and /m/login is served rather than bounced back.
     *
     * The `prefer-desktop` cookie still wins, as it does everywhere else.
     */
    if (path === "/login" && isPhone && !preferDesktop) {
      return NextResponse.redirect(new URL("/m/login" + req.nextUrl.search, req.url))
    }

    /*
     * Accepting an invite has a phone composition too, and like the phone
     * shutdown notice it lives OUTSIDE `/m`: every route under that segment
     * inherits the tab bar, and someone who does not have an account yet
     * cannot be offered five tabs into the account.
     *
     * A rewrite rather than a redirect, so the link that arrived in the email
     * is the link in the address bar. `?desk=1` is the escape hatch the phone
     * page uses when the invite is dead — the four refusals are drawn once, on
     * the desk route, and this guard is what stops that bouncing back here.
     */
    if (
      isPhone &&
      !preferDesktop &&
      path.startsWith("/signup/") &&
      !path.startsWith("/signup/phone/") &&
      req.nextUrl.searchParams.get("desk") !== "1"
    ) {
      return NextResponse.rewrite(
        new URL(
          "/signup/phone" + path.slice("/signup".length) + req.nextUrl.search,
          req.url,
        ),
      )
    }

    if (
      path === "/" ||
      path === "/login" ||
      path === "/m/login" ||
      path === "/register" ||
      path.startsWith("/signup/")
    ) {
      return NextResponse.next()
    }

    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url))
    }

    /*
     * The shutdown notice has a phone composition too, and it is reachable
     * outside the gate: an owner previewing it, or anyone who kept the URL.
     * The gate's own rewrite above picks the same page — this is the same rule
     * for the case where the gate is not armed.
     */
    if (isPhone && !preferDesktop && path === "/shutdown") {
      return NextResponse.rewrite(
        new URL("/shutdown/phone" + req.nextUrl.search, req.url),
      )
    }

    if (isPhone && !preferDesktop && path.startsWith("/dashboard")) {
      const target = mobilePathFor(path)
      if (target) {
        return NextResponse.redirect(
          new URL(target + req.nextUrl.search, req.url)
        )
      }
    }

    /*
     * The legacy paths, redirected HERE rather than by the pages that bear
     * their names — and this is a bug fix, not a tidy-up.
     *
     * Six routes exist only to forward an old bookmark: `/dashboard/chat`,
     * `/dashboard/operations/costs`, `/dashboard/operations/recipes`,
     * `/dashboard/stores/<id>/edit`, `/dashboard/pnl/<id>` and `/m/settings`.
     * Each is a Server Component whose whole body is `redirect(...)`, which is
     * the documented way to do this and which DOES NOT WORK from inside a
     * streamed layout. By the time the page component runs, the layout above
     * it has already flushed the shell, the response headers are gone, and
     * Next falls back to what it can still do:
     *
     *     <meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/dashboard/ask">
     *
     * A ONE-SECOND WAIT on a page that is not the page, and React hydrating a
     * document it is about to throw away — measured against a production build,
     * 15 of 18 loads threw a hydration mismatch (React #418). It is invisible
     * in dev, where the same eighteen loads are clean, and invisible to every
     * gate: the fidelity harness follows the redirect and measures the
     * destination. `e2e/desktop/console-sweep.spec.ts` did not see it either,
     * because it walks the fifty GATED routes and none of these six is one.
     *
     * Middleware runs before any rendering, so a redirect from here is a real
     * 307 with no document, no wasted hydration and no second of waiting.
     *
     * The page files stay. They are the fallback if this list and the tree
     * ever disagree, and `/dashboard/pnl/<id>` in particular is still a route
     * on purpose — two server actions call
     * `revalidatePath("/dashboard/pnl/<id>")`, and a path no route serves
     * revalidates nothing.
     *
     * All five desk shims now sit directly under `src/app/dashboard/` rather
     * than inside a route group. They were graduated out of `(editorial)` on
     * 2026-09-04, which emptied that group of pages and let its layout — a
     * cream sidebar, a chat drawer, a QueryProvider and four stylesheets, all
     * mounted to serve a one-line `redirect()` — be deleted outright.
     *
     * AFTER the phone block above, deliberately: `/dashboard/chat` maps to a
     * phone route and that mapping still wins. It maps to `/m/ask` now —
     * `/m/chat` was retired once the phone's Counter Ask grew the thread
     * history that was the whole reason for keeping it.
     */
    const legacy = legacyTargetFor(path)
    if (legacy) {
      return NextResponse.redirect(new URL(legacy + req.nextUrl.search, req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: () => true,
    },
  }
)

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
}
