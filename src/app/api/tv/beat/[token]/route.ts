import { NextRequest, NextResponse } from "next/server"
import { PLAYER_VERSION, hashToken, isDeviceToken, storeOffsetMinutes } from "@/lib/screens/core"
import { checkBeatTicket, markSeen } from "@/lib/screens/push"

/**
 * "I am on", from a TV, every few minutes. The answer is the time, which the
 * TV sets its clock from (its cached playlist answer can be an hour old).
 *
 * Never touches the database, so it never wakes it. A TV that sends the
 * ticket from its playlist answer is noted in Redis with one command; anyone
 * else gets the time and nothing is written. No rate limiter: it would cost
 * more Redis commands than the beat itself.
 */
export const dynamic = "force-dynamic"

const HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isDeviceToken(token)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: HEADERS })

  const q = request.nextUrl.searchParams
  const tokenHash = hashToken(token)
  if (checkBeatTicket(tokenHash, q.get("k"))) {
    await markSeen(tokenHash, q.get("d")?.slice(0, 120) || null)
  }

  const now = new Date()
  return NextResponse.json(
    { clock: { now: now.toISOString(), offsetMinutes: storeOffsetMinutes(now) }, player: PLAYER_VERSION },
    { headers: HEADERS },
  )
}
