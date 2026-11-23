import { NextRequest, NextResponse } from "next/server"
import { hashToken, tokenFromHeader } from "@/lib/screens/core"
import { contentFor } from "@/lib/screens/data"
import { rateLimitKey } from "@/lib/rate-limit"

/**
 * What a TV should show. The TV calls this every 30 seconds with its token.
 * Before it is paired the answer is its code; after, its playlist.
 */
export async function GET(request: NextRequest) {
  const token = tokenFromHeader(request.headers.get("authorization"))
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 })
  const tokenHash = hashToken(token)

  const limited = await rateLimitKey(`tv:${tokenHash.slice(0, 24)}`, { limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const device = request.headers.get("x-screen-device")?.slice(0, 120) ?? null
  const content = await contentFor(tokenHash, device)
  return NextResponse.json(content, { headers: { "Cache-Control": "no-store" } })
}
