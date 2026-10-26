import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getCheckPhotoStream } from "@/lib/blob"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

/** A store check photo, for owners of the store's account only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.beacon)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasOwnerAccess(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const photo = await prisma.checkPhoto.findFirst({
    where: { id, submission: { store: { accountId: session.user.accountId } } },
    select: { storageKey: true, contentType: true },
  })
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 })

  let result
  try {
    result = await getCheckPhotoStream(photo.storageKey)
  } catch (err) {
    logger.error("[check-photo] fetch failed", { id, message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Photo storage is temporarily unavailable" }, { status: 503 })
  }
  if (result.statusCode !== 200) return NextResponse.json({ error: "Photo not found in storage" }, { status: 404 })

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.contentType ?? photo.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
