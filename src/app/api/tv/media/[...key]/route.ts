import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkThumbKey, getScreenMediaStream } from "@/lib/blob"
import { logger } from "@/lib/logger"

/**
 * A screen image, for the TV and for the dashboard's thumbnails. No sign-in:
 * a TV cannot send one with an <img>. The key holds a random uuid, it must
 * match a row, and an image is never changed in place (a new upload is a new
 * key), so the TV and the browser keep it for a year; shared caches don't.
 * Any origin may read it, so the Samsung app (which runs from its own package)
 * can save it for offline play.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params
  let blobKey: string
  try {
    blobKey = key.map(decodeURIComponent).join("/")
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!/^screens\/[A-Za-z0-9._-]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(blobKey)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const media = await prisma.screenMedia.findUnique({ where: { blobKey }, select: { contentType: true } })
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let result
  try {
    // `?small=1`: the dashboard's copy. Pictures uploaded before small copies existed have none.
    result = request.nextUrl.searchParams.has("small") ? await getScreenMediaStream(checkThumbKey(blobKey)) : null
    if (result?.statusCode !== 200) result = await getScreenMediaStream(blobKey)
  } catch (err) {
    logger.error("[screens] media fetch failed", { blobKey, message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Image storage is temporarily unavailable" }, { status: 503 })
  }
  if (result.statusCode !== 200) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.contentType ?? media.contentType,
      // private: a deleted image must not live on in a shared cache.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
