import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/dashboard": "/m",
  "/dashboard/chat": "/m/chat",
  "/dashboard/ingredients": "/m/ingredients",
  "/dashboard/invoices": "/m/invoices",
  "/dashboard/menu": "/m/menu",
  "/dashboard/operations": "/m/operations",
  "/dashboard/orders": "/m/orders",
  "/dashboard/pnl": "/m/pnl",
  "/dashboard/product-mix": "/m/product-mix",
  "/dashboard/recipes": "/m/recipes",
  // Analytics, COGS, Stores had no mobile equivalent left after the mobile
  // bloat deletion — leave those desktop paths unmapped (mobilePathFor
  // returns null and the request stays on desktop).
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
// left on desktop. (Analytics, COGS, and Stores were deleted from mobile
// entirely — see DESKTOP_TO_MOBILE above.)
const DYNAMIC_SUBROUTES: Array<[string, string]> = [
  ["/dashboard/invoices", "/m/invoices"],
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
