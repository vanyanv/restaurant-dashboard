import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/auth-scope"
import { hasOwnerAccess } from "@/lib/auth"
import { checkThumbKey, deleteScreenMedia, putScreenMedia, putScreenOriginal, putScreenThumb, readScreenPart, screenPartKey } from "@/lib/blob"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import { SCREEN_MAX_PARTS, SCREEN_MEDIA_MAX_BYTES, SCREEN_THUMB_MAX_BYTES, sniffImage } from "@/lib/screens/core"
import { SCREEN_ORIGINAL_MAX_BYTES, SCREEN_ORIGINAL_MAX_PARTS } from "@/lib/screens/limits"

const Input = z.object({
  upload: z.string().uuid(),
  parts: z.coerce.number().int().min(1).max(SCREEN_MAX_PARTS),
  name: z.string().trim().max(200).default(""),
  width: z.coerce.number().int().min(1).max(20_000),
  height: z.coerce.number().int().min(1).max(20_000),
  /** Sent only when the TV copy was redrawn: the owner's own file, in its own parts. */
  original: z.string().uuid().optional(),
  originalParts: z.coerce.number().int().min(1).max(SCREEN_ORIGINAL_MAX_PARTS).optional(),
})

/**
 * Finish one picture: join the parts it was sent in and keep exactly those
 * bytes. Nothing here re-encodes it, so the TV gets the owner's own file.
 * When the browser had to redraw the TV copy (bigger than 4K, or over 25 MB)
 * it also sends the original, which is kept untouched beside it.
 * Owners only. `thumb` is the small JPEG the dashboard shows.
 */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, { limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const session = await getSession()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasOwnerAccess(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const accountId = session.user.accountId

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "That upload could not be read" }, { status: 400 })
  }
  const parsed = Input.safeParse(Object.fromEntries([...form].filter(([, v]) => typeof v === "string")))
  if (!parsed.success) return NextResponse.json({ error: "That upload could not be read" }, { status: 400 })
  const { upload, parts, width, height, original, originalParts } = parsed.data
  if ((original === undefined) !== (originalParts === undefined) || original === upload) {
    return NextResponse.json({ error: "That upload could not be read" }, { status: 400 })
  }

  const keys = Array.from({ length: parts }, (_, i) => screenPartKey(accountId, upload, i))
  const originalKeys = original
    ? Array.from({ length: originalParts! }, (_, i) => screenPartKey(accountId, original, i))
    : []
  const cleanUp = () =>
    Promise.all([...keys, ...originalKeys].map((k) => deleteScreenMedia(k).catch(() => undefined))).then(() => undefined)

  const [chunks, originalChunks] = await Promise.all([
    Promise.all(keys.map(readScreenPart)),
    Promise.all(originalKeys.map(readScreenPart)),
  ])
  if ([...chunks, ...originalChunks].some((c) => c === null)) {
    await cleanUp()
    return NextResponse.json({ error: "Part of that picture didn't arrive. Try again." }, { status: 409 })
  }
  const bytes = Buffer.concat(chunks as Buffer[])
  const type = sniffImage(bytes)
  const originalBytes = original ? Buffer.concat(originalChunks as Buffer[]) : null
  const originalType = originalBytes ? sniffImage(originalBytes) : null
  if (!type || bytes.length > SCREEN_MEDIA_MAX_BYTES || (originalBytes && (!originalType || originalBytes.length > SCREEN_ORIGINAL_MAX_BYTES))) {
    await cleanUp()
    return type && (!originalBytes || originalType)
      ? NextResponse.json({ error: "That picture is too large. Try a smaller copy." }, { status: 413 })
      : NextResponse.json({ error: "Use a JPG, PNG or WebP picture" }, { status: 415 })
  }

  let media: { id: string }
  const stored = await putScreenMedia(accountId, bytes, type)
  let originalKey: string | null = null
  try {
    if (originalBytes && originalType) originalKey = await putScreenOriginal(stored.pathname, originalBytes, originalType)
    const thumb = form.get("thumb")
    if (thumb instanceof File && thumb.size > 0 && thumb.size <= SCREEN_THUMB_MAX_BYTES) {
      const small = Buffer.from(await thumb.arrayBuffer())
      // The dashboard falls back to the full picture without one.
      if (sniffImage(small) === "image/jpeg") {
        await putScreenThumb(stored.pathname, small).catch((err) =>
          logger.error("[screens] thumb failed", { message: err instanceof Error ? err.message : String(err) }),
        )
      }
    }
    media = await prisma.screenMedia.create({
      data: {
        accountId,
        storeId: null,
        name: (parsed.data.name || "Picture").slice(0, 80),
        blobKey: stored.pathname,
        contentType: type,
        width,
        height,
        bytes: stored.size,
        originalKey,
        originalBytes: originalBytes?.length ?? null,
      },
      select: { id: true },
    })
  } catch (err) {
    // No row points at it, so nothing would ever delete it. The parts stay for the browser's second try.
    await Promise.all(
      [stored.pathname, checkThumbKey(stored.pathname), ...(originalKey ? [originalKey] : [])].map((k) =>
        deleteScreenMedia(k).catch(() => undefined),
      ),
    )
    logger.error("[screens] upload failed", { message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Couldn't save that picture. Try again." }, { status: 503 })
  }
  await cleanUp()

  revalidatePath("/dashboard/screens")
  revalidatePath("/m/screens")
  return NextResponse.json({ ok: true, id: media.id })
}
