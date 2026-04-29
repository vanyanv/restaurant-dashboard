import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

const PHONE_UA = /iPhone|iPod|Android.*Mobile/i

const DESKTOP_TO_MOBILE: Record<string, string> = {
  "/dashboard": "/m",
  "/dashboard/analytics": "/m/analytics",
  "/dashboard/chat": "/m/chat",
  "/dashboard/cogs": "/m/cogs",
  "/dashboard/ingredients": "/m/ingredients",
  "/dashboard/invoices": "/m/invoices",
  "/dashboard/menu": "/m/menu",
  "/dashboard/operations": "/m/operations",
  "/dashboard/orders": "/m/orders",
  "/dashboard/pnl": "/m/pnl",
  "/dashboard/product-mix": "/m/product-mix",
  "/dashboard/recipes": "/m/recipes",
  "/dashboard/settings": "/m/settings",
  "/dashboard/stores": "/m/stores",
}

function mobilePathFor(desktopPath: string): string | null {
  if (DESKTOP_TO_MOBILE[desktopPath]) return DESKTOP_TO_MOBILE[desktopPath]
  for (const [base, mobileBase] of Object.entries(DESKTOP_TO_MOBILE)) {
    if (desktopPath.startsWith(base + "/")) {
      return mobileBase + desktopPath.slice(base.length)
    }
  }
  return null
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

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
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
}
