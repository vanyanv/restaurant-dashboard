import { NextResponse } from "next/server"
import { getCheckPhotoStream } from "@/lib/blob"
import { PHOTO_CACHE_CONTROL } from "./photo"
import { logger } from "@/lib/logger"

/** One reference photo from storage. Keys never change content, so the browser keeps it. */
export async function streamHelpPhoto(key: string): Promise<Response> {
  let photo
  try {
    photo = await getCheckPhotoStream(key)
  } catch (err) {
    logger.error("[check-help-photo] fetch failed", { key, message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Photo storage is temporarily unavailable" }, { status: 503 })
  }
  if (photo.statusCode !== 200) return NextResponse.json({ error: "Photo not found in storage" }, { status: 404 })
  return new Response(photo.stream, {
    headers: {
      "Content-Type": photo.contentType ?? (key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg"),
      "Cache-Control": PHOTO_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
