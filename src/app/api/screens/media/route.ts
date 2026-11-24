import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/auth-scope"
import { hasOwnerAccess } from "@/lib/auth"
import { checkThumbKey, deleteScreenMedia, putScreenMedia, putScreenThumb, readScreenPart, screenPartKey } from "@/lib/blob"
import { logger } from "@/lib/logger"
import { rateLimit } from "@/lib/rate-limit"
import { SCREEN_MAX_PARTS, SCREEN_MEDIA_MAX_BYTES, SCREEN_THUMB_MAX_BYTES, sniffImage } from "@/lib/screens/core"

const Input = z.object({
  upload: z.string().uuid(),
  parts: z.coerce.number().int().min(1).max(SCREEN_MAX_PARTS),
  name: z.string().trim().max(200).default(""),
  width: z.coerce.number().int().min(1).max(20_000),
  height: z.coerce.number().int().min(1).max(20_000),
})

/**
 * Finish one picture: join the parts it was sent in and keep exactly those
 * bytes. Nothing here re-encodes it, so the TV gets the owner's own file.
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
  const { upload, parts, width, height } = parsed.data

  const keys = Array.from({ length: parts }, (_, i) => screenPartKey(accountId, upload, i))
  const cleanUp = () =>
    Promise.all(keys.map((k) => deleteScreenMedia(k).catch(() => undefined))).then(() => undefined)

  const chunks = await Promise.all(keys.map(readScreenPart))
  if (chunks.some((c) => c === null)) {
    await cleanUp()
    return NextResponse.json({ error: "Part of that picture didn't arrive. Try again." }, { status: 409 })
  }
  const bytes = Buffer.concat(chunks as Buffer[])
  const type = sniffImage(bytes)
  if (!type || bytes.length > SCREEN_MEDIA_MAX_BYTES) {
    await cleanUp()
    return type
      ? NextResponse.json({ error: "That picture is too large. Try a smaller copy." }, { status: 413 })
      : NextResponse.json({ error: "Use a JPG, PNG or WebP picture" }, { status: 415 })
  }

  let media: { id: string }
  const stored = await putScreenMedia(accountId, bytes, type)
  try {
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
      },
      select: { id: true },
    })
  } catch (err) {
    // No row points at it, so nothing would ever delete it. The parts stay for the browser's second try.
    await Promise.all([stored.pathname, checkThumbKey(stored.pathname)].map((k) => deleteScreenMedia(k).catch(() => undefined)))
    logger.error("[screens] upload failed", { message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Couldn't save that picture. Try again." }, { status: 503 })
  }
  await cleanUp()

  revalidatePath("/dashboard/screens")
  revalidatePath("/m/screens")
  return NextResponse.json({ ok: true, id: media.id })
}
