import { NextRequest, NextResponse } from "next/server"
import { hashToken, isDeviceToken } from "@/lib/screens/core"
import { screenContent, type TvCached } from "@/lib/screens/data"
import { beatTicket, cdnSeconds, pushFor, tvTag } from "@/lib/screens/push"
import { clientIp, rateLimitKey } from "@/lib/rate-limit"

/**
 * What a paired TV should show, for the player from version 4 on.
 *
 * Vercel's CDN keeps the answer, so a TV asking every few seconds runs no
 * function, no Redis command and no query until something changes. That is
 * why the token is in the path and the TV sends no Authorization header: the
 * CDN will not keep an answer to a request that carries one, and a plain GET
 * needs no CORS preflight either.
 *
 * The answer is cleared by its tag when the owner saves (`tvsChanged`), and
 * ends on its own at the top of the hour.
 *
 * A TV that is not paired is told so and nothing more. It gets its code from
 * /api/tv/content, as before; no code is made here.
 */
export const dynamic = "force-dynamic"

const OPEN = { "Access-Control-Allow-Origin": "*" }
const NO_STORE = { ...OPEN, "Cache-Control": "no-store" }

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...OPEN, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isDeviceToken(token)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE })

  // Only asked when the CDN has no answer, so this counts misses, not polls.
  // Keyed on the address alone: `rateLimit` adds the path, and the path here
  // holds the token, so every made-up token would get a fresh count (and the
  // token itself would be written into Redis).
  // Every TV in a store shares one address, and each save makes each of them
  // miss once or twice, so the count is sized for 20 TVs and a save every few
  // seconds. A miss is one indexed read.
  const perIp = await rateLimitKey(`tv-c:${clientIp(request)}`, { limit: 600, windowMs: 60_000 })
  if (perIp) {
    for (const [k, v] of Object.entries(NO_STORE)) perIp.headers.set(k, v)
    return perIp
  }

  const tokenHash = hashToken(token)
  // No device name on this path: the TV sends no headers. The beat carries it.
  // And no "seen" write: the beat says the TV is on, and a write here would
  // only widen the moment between reading the row and answering, which is
  // when a save can slip in and leave the CDN holding the older answer.
  const found = await screenContent(tokenHash, null, { note: false })
  if (!found) return NextResponse.json({ paired: false }, { headers: NO_STORE })

  const body: TvCached = { ...found.content, beat: beatTicket(tokenHash), push: pushFor(found.accountId, tokenHash) }
  return NextResponse.json(body, {
    headers: {
      ...OPEN,
      // Browsers and the TV always ask again; only Vercel's CDN keeps it.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": `public, max-age=${cdnSeconds()}`,
      "Vercel-Cache-Tag": tvTag(found.accountId),
    },
  })
}
