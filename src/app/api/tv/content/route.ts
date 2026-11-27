import { NextRequest, NextResponse } from "next/server"
import { cleanDevice, hashToken, tokenFromHeader } from "@/lib/screens/core"
import { contentFor } from "@/lib/screens/data"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"

/**
 * What a TV should show. The TV calls this every 30 to 60 seconds with its token; while nothing has
 * changed the answer comes from Redis, not the database (tv-cache.ts).
 * Before it is paired the answer is its code; after, its playlist.
 *
 * Open to any origin: the Samsung app runs from its own package, not from
 * this site. That is safe because nothing here uses cookies; the TV's token
 * travels in the Authorization header.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-screen-device",
  "Access-Control-Max-Age": "86400",
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  // Per address too: a client sending a new token each time would otherwise make codes without limit.
  // Generous, because every TV in a store shares one address.
  const perIp = await rateLimit(request, { limit: 120, windowMs: 60_000, identifyBy: "ip" })
  if (perIp) return withCors(perIp)

  const token = tokenFromHeader(request.headers.get("authorization"))
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401, headers: CORS })
  const tokenHash = hashToken(token)

  const limited = await rateLimitKey(`tv:${tokenHash.slice(0, 24)}`, { limit: 30, windowMs: 60_000 })
  if (limited) return withCors(limited)

  const device = cleanDevice(request.headers.get("x-screen-device"))
  const content = await contentFor(tokenHash, device)
  return NextResponse.json(content, { headers: { ...CORS, "Cache-Control": "no-store" } })
}

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
}
