import { after, NextRequest, NextResponse } from "next/server"
import { cleanDevice, hashToken, tokenFromHeader } from "@/lib/screens/core"
import { freshContentFor, savedContentFor } from "@/lib/screens/data"
import { rateLimit, rateLimitKey, rateLimitLocal } from "@/lib/rate-limit"

/**
 * What a TV should show. The TV calls this every 30 seconds (every 3 minutes while Pusher's socket is up) with its token; while nothing has
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
  const token = tokenFromHeader(request.headers.get("authorization"))
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401, headers: CORS })
  const tokenHash = hashToken(token)
  const tvKey = `tv:${tokenHash.slice(0, 24)}`
  const device = cleanDevice(request.headers.get("x-screen-device"))

  // Counted in memory first, so a check-in spends no Redis command on counting
  // itself, and one stuck in a loop spends none at all (the free plan counts
  // commands).
  const local = rateLimitLocal(tvKey, { limit: 30, windowMs: 60_000 })
  if (local) return withCors(local)

  // Answered from Redis: one command, and nothing in the database.
  const saved = await savedContentFor(tokenHash, device)
  if (saved.content) {
    if (saved.afterwards) after(saved.afterwards)
    return NextResponse.json(saved.content, { headers: { ...CORS, "Cache-Control": "no-store" } })
  }

  // To the database. Per address too: a client sending a new token each time
  // would otherwise make codes without limit (a made-up token is never in
  // Redis, so it always lands here). Generous, because every TV in a store
  // shares one address.
  const perIp = await rateLimit(request, { limit: 120, windowMs: 60_000, identifyBy: "ip" })
  if (perIp) return withCors(perIp)
  const limited = await rateLimitKey(tvKey, { limit: 30, windowMs: 60_000 })
  if (limited) return withCors(limited)

  const content = await freshContentFor(tokenHash, device, saved.gen)
  return NextResponse.json(content, { headers: { ...CORS, "Cache-Control": "no-store" } })
}

function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
}
