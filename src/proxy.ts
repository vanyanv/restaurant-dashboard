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
import { PHONE_UA, mobilePathFor } from "@/lib/phone-routes"

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
      path.startsWith("/signup/") ||
      // Store checks: crew sign in with a PIN on the store's own page, not a
      // dashboard account. The logo is printed on that page and the poster.
      path.startsWith("/checks/") ||
      path === "/checks-logo.png"
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

    /*
     * Back on a phone page means back on the phone. `DeskHandoff` sets
     * `prefer-desktop` for a week so one desk edit can be reached, and nothing
     * ever cleared it: every `/dashboard` link for the next seven days then
     * stayed on the desk shell, which is where "the bottom bar disappears"
     * came from. A phone page is only reached from the bar or a phone link,
     * so arriving on one ends the desk preference.
     */
    if (preferDesktop && (path === "/m" || path.startsWith("/m/"))) {
      const res = NextResponse.next()
      res.cookies.delete("prefer-desktop")
      return res
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
      const destination = new URL(legacy, req.url)
      // The path-derived store wins; all other filters survive the redirect.
      for (const [key, value] of req.nextUrl.searchParams) {
        if (!destination.searchParams.has(key)) destination.searchParams.set(key, value)
      }
      return NextResponse.redirect(destination)
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
