import { checkThumbKey, getCheckPhotoStream } from "@/lib/blob"

export type PhotoSize = "full" | "thumb"

export function photoSizeFrom(url: string): PhotoSize {
  return new URL(url).searchParams.get("size") === "thumb" ? "thumb" : "full"
}

/**
 * Read a check photo from storage. For `thumb`, the small copy saved at
 * upload; a photo taken before small copies existed has none, so it falls
 * back to the full photo rather than showing nothing.
 */
export async function readCheckPhoto(
  photoKey: string,
  size: PhotoSize,
): Promise<{ found: boolean; stream: ReadableStream<Uint8Array>; contentType: string | null; thumb: boolean }> {
  if (size === "thumb") {
    const small = await getCheckPhotoStream(checkThumbKey(photoKey))
    if (small.statusCode === 200) return { found: true, stream: small.stream, contentType: "image/jpeg", thumb: true }
    await small.stream.cancel().catch(() => {})
  }
  const full = await getCheckPhotoStream(photoKey)
  return { found: full.statusCode === 200, stream: full.stream, contentType: full.contentType, thumb: false }
}
