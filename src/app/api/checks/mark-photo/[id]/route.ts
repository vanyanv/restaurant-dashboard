import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PHOTO_CACHE_CONTROL } from "@/lib/checks/photo"
import { photoSizeFrom, readCheckPhoto } from "@/lib/checks/photo-serve"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

/** A photo taken on a task of the shared form, for owners of the store's account only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.beacon)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasOwnerAccess(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const photo = await prisma.checkMark.findFirst({
    where: { id, photoKey: { not: null }, store: { accountId: session.user.accountId } },
    select: { photoKey: true, photoType: true },
  })
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 })

  let result
  try {
    result = await readCheckPhoto(photo.photoKey!, photoSizeFrom(request.url))
  } catch (err) {
    logger.error("[check-mark-photo] fetch failed", { id, message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Photo storage is temporarily unavailable" }, { status: 503 })
  }
  if (!result.found) return NextResponse.json({ error: "Photo not found in storage" }, { status: 404 })

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.contentType ?? photo.photoType ?? "image/jpeg",
      "X-Photo-Size": result.thumb ? "thumb" : "full",
      "Cache-Control": PHOTO_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
