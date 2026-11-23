import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth-scope"
import { hasOwnerAccess } from "@/lib/auth"
import { putScreenPart, screenPartKey } from "@/lib/blob"
import { rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { SCREEN_MAX_PARTS, SCREEN_PART_BYTES } from "@/lib/screens/limits"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * One part of a picture that is too big for one request (Vercel refuses a
 * body over 4.5 MB), so the owner's file reaches storage byte for byte
 * instead of being squeezed into a smaller JPEG. Owners only; the parts live
 * under the account's own folder until POST /api/screens/media joins them.
 */
export async function PUT(request: NextRequest) {
  const limited = await rateLimit(request, { limit: 240, windowMs: 60_000 })
  if (limited) return limited
  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasOwnerAccess(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // About 6 GB a day for an account: far past any menu change, well short of filling storage.
  const spent = await rateLimitKey(`screens-parts:${session.user.accountId}`, { limit: 1500, windowMs: 24 * 60 * 60_000 })
  if (spent) return spent

  const upload = request.nextUrl.searchParams.get("upload") ?? ""
  const part = Number(request.nextUrl.searchParams.get("part"))
  if (!UUID.test(upload) || !Number.isInteger(part) || part < 0 || part >= SCREEN_MAX_PARTS) {
    return NextResponse.json({ error: "That upload could not be read" }, { status: 400 })
  }
  const bytes = Buffer.from(await request.arrayBuffer())
  if (bytes.length === 0 || bytes.length > SCREEN_PART_BYTES) {
    return NextResponse.json({ error: "That upload could not be read" }, { status: 400 })
  }
  await putScreenPart(screenPartKey(session.user.accountId, upload, part), bytes)
  return NextResponse.json({ ok: true })
}
