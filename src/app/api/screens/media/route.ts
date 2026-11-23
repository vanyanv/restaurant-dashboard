import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/auth-scope"
import { hasOwnerAccess } from "@/lib/auth"
import { putScreenMedia } from "@/lib/blob"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { SCREEN_MEDIA_MAX_BYTES, isScreenMediaType } from "@/lib/screens/core"

/**
 * Upload one image to Screens. Owners only. The browser has already shrunk
 * it to fit a 4K screen and Vercel's body limit (see SCREEN_MEDIA_MAX_BYTES).
 * `storeId` empty means every store can use it.
 */
export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
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
  const file = form.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "No image in the upload" }, { status: 400 })
  if (!isScreenMediaType(file.type)) {
    return NextResponse.json({ error: "Use a JPG, PNG or WebP image" }, { status: 415 })
  }
  if (file.size > SCREEN_MEDIA_MAX_BYTES) {
    return NextResponse.json({ error: "That image is too large. Try a smaller copy." }, { status: 413 })
  }

  const storeIdRaw = form.get("storeId")
  const storeId = typeof storeIdRaw === "string" && storeIdRaw ? storeIdRaw : null
  if (storeId) {
    const store = await prisma.store.findFirst({ where: { id: storeId, accountId }, select: { id: true } })
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 })
  }
  const nameRaw = form.get("name")
  const name = (typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : file.name.replace(/\.[^.]+$/, "") || "Image").slice(0, 80)
  const num = (k: string) => {
    const v = Number(form.get(k))
    return Number.isInteger(v) && v > 0 && v < 20_000 ? v : null
  }

  const upload = await putScreenMedia(accountId, Buffer.from(await file.arrayBuffer()), file.type)
  const media = await prisma.screenMedia.create({
    data: {
      accountId,
      storeId,
      name,
      blobKey: upload.pathname,
      contentType: file.type,
      width: num("width"),
      height: num("height"),
      bytes: upload.size,
    },
    select: { id: true },
  })

  revalidatePath("/dashboard/screens")
  revalidatePath("/m/screens")
  return NextResponse.json({ ok: true, id: media.id })
}
