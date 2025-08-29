import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const path = req.nextUrl.pathname

    // Allow access to public routes
    if (path === "/" || path === "/login" || path === "/register") {
      return NextResponse.next()
    }

    // Redirect if not authenticated
    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url))
    }

    // Role-based access control
    if (path.startsWith("/admin") && token.role !== "OWNER") {
      return NextResponse.redirect(new URL("/dashboard", req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => true, // We handle authorization in the middleware function
    },
  }
)

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
}