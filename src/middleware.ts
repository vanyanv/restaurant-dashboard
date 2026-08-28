import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/dashboard": "/m",
  "/dashboard/alerts": "/m/alerts",
  "/dashboard/analytics": "/m/analytics",
  "/dashboard/ask": "/m/ask",
  "/dashboard/chat": "/m/chat",
  "/dashboard/cogs": "/m/cogs",
  "/dashboard/decisions": "/m/decisions",
  "/dashboard/ingredients": "/m/ingredients",
  "/dashboard/invoices": "/m/invoices",
  "/dashboard/labor": "/m/labor",
  "/dashboard/menu": "/m/menu",
  "/dashboard/operations": "/m/operations",
  "/dashboard/orders": "/m/orders",
  "/dashboard/pnl": "/m/pnl",
  // Desktop Product Mix was retired into Menu Profit (the two ranked menu
  // items by the same measure, and Menu Profit's own docblock called the
  // Product Mix scatter superseded). /m/product-mix stays — it is the phone's
  // only menu-performance view — so Menu Profit maps to it, and the retired
  // desktop path keeps its mapping for bookmarks.
  "/dashboard/menu-profit": "/m/product-mix",
  "/dashboard/product-mix": "/m/product-mix",
  "/dashboard/recipes": "/m/recipes",
  // Stores had no mobile equivalent left after the mobile bloat deletion —
  // leave that desktop path unmapped (mobilePathFor returns null and the
  // request stays on desktop). Analytics was in that list until it was
  // rebuilt on Counter with a phone surface of its own; it is mapped above,
  // and so is Ask, which was unmapped for the different reason that /m/ask did
  // not exist until the Counter Ask page was built on both surfaces. COGS was
  // in that list too until this task gave it a phone route of its own — see
  // the entry above.
  //
  // The list is NOT exhaustive of what is unmapped: /dashboard/admin/monitoring
  // has a phone page (/m/monitoring) and no entry here, so a phone lands on the
  // desktop admin view. That predates this map's Counter entries and is left
  // alone rather than mapped on the way past — it is an admin route, and
  // whether the phone view is the intended destination is a question for
  // whoever owns it, not a side effect of adding Ask.
  // Settings folded into /m/more (profile + sign-out) — map straight there
  // instead of through /m/settings (which itself now just redirects to
  // /m/more) to avoid an unnecessary extra hop.
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
  ["/dashboard/orders", "/m/orders"],
  ["/dashboard/pnl", "/m/pnl"],
]

function mobilePathFor(desktopPath: string): string | null {
  if (DESKTOP_TO_MOBILE[desktopPath]) return DESKTOP_TO_MOBILE[desktopPath]
  for (const [base, mobileBase] of DYNAMIC_SUBROUTES) {
    if (desktopPath.startsWith(base + "/")) {
      return mobileBase + desktopPath.slice(base.length)
    }
  }
  return null
}

const shutdownAt = process.env.SERVICE_SHUTDOWN_AT

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    if (shutdownAt && token?.role !== "OWNER") {
      if (
        path === "/shutdown" ||
        path === "/login" ||
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
      return NextResponse.rewrite(new URL("/shutdown", req.url))
    }

    // API routes were never subject to the auth/mobile logic below; the
    // matcher includes them only so the shutdown gate can cover them.
    if (path.startsWith("/api/")) {
      return NextResponse.next()
    }

    if (
      path === "/" ||
      path === "/login" ||
      path === "/register" ||
      path.startsWith("/signup/")
    ) {
      return NextResponse.next()
    }

    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url))
    }

    const ua = req.headers.get("user-agent") ?? ""
    const isPhone = PHONE_UA.test(ua)
    const preferDesktop = req.cookies.get("prefer-desktop")?.value === "1"

    if (isPhone && !preferDesktop && path.startsWith("/dashboard")) {
      const target = mobilePathFor(path)
      if (target) {
        return NextResponse.redirect(
          new URL(target + req.nextUrl.search, req.url)
        )
      }
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
