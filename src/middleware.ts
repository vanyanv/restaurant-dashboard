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

    // Block managers from accessing dashboard routes
    if (token.role === "MANAGER" && path.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/manager/report", req.url))
    }
    
    // Block owners from accessing manager routes (optional, for clean separation)
    if (token.role === "OWNER" && path.startsWith("/manager")) {
      return NextResponse.redirect(new URL("/dashboard", req.url))
    }

    // Role-based access control for admin routes
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