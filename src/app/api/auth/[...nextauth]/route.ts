import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { NextRequest } from "next/server"

// Force Node.js runtime to prevent Edge runtime issues with credentials provider
export const runtime = 'nodejs'

const handler = NextAuth(authOptions)

async function rateLimitedPost(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const params = await ctx.params
  // Only rate-limit signin/callback POSTs, not session checks
  if (params.nextauth?.includes("callback")) {
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.auth)
    if (limited) return limited
  }
  return handler(req, ctx)
}

export { handler as GET, rateLimitedPost as POST }