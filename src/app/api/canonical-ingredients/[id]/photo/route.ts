import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  deleteProductPhoto,
  getProductPhotoStream,
  isProductPhotoContentType,
  putProductPhoto,
} from "@/lib/blob"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8 MB

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const ingredient = await prisma.canonicalIngredient.findFirst({
    where: { id, accountId: session.user.accountId },
    select: { photoBlobPathname: true, photoContentType: true },
  })

  if (!ingredient) {
    return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })
  }
  if (!ingredient.photoBlobPathname) {
    return NextResponse.json({ error: "No photo" }, { status: 404 })
  }

  let result
  try {
    result = await getProductPhotoStream(ingredient.photoBlobPathname)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error("[ingredient-photo] R2 fetch failed", { ingredientId: id, message })
    return NextResponse.json(
      { error: "Photo storage is temporarily unavailable" },
      { status: 503 },
    )
  }

  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "Photo not found in storage" }, { status: 404 })
  }

  return new Response(result.stream, {
    headers: {
      "Content-Type": result.contentType ?? ingredient.photoContentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "DEVELOPER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  const ingredient = await prisma.canonicalIngredient.findFirst({
    where: { id, accountId: session.user.accountId },
    select: { id: true, photoBlobPathname: true },
  })
  if (!ingredient) {
    return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart form" }, { status: 400 })
  }
  const photo = formData.get("photo")
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Missing photo field" }, { status: 400 })
  }
  if (!isProductPhotoContentType(photo.type)) {
    return NextResponse.json(
      { error: `Unsupported content type: ${photo.type || "(unknown)"}` },
      { status: 415 },
    )
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `Photo exceeds ${MAX_PHOTO_BYTES} bytes` },
      { status: 413 },
    )
  }

  const buf = Buffer.from(await photo.arrayBuffer())
  const upload = await putProductPhoto(ingredient.id, buf, photo.type)

  const previousPathname = ingredient.photoBlobPathname
  await prisma.canonicalIngredient.update({
    where: { id: ingredient.id },
    data: {
      photoBlobPathname: upload.pathname,
      photoContentType: photo.type,
      photoUploadedAt: upload.uploadedAt,
    },
  })

  if (previousPathname && previousPathname !== upload.pathname) {
    try {
      await deleteProductPhoto(previousPathname)
    } catch (err) {
      // Orphaned blob — log and move on. A sweep job can collect later.
      logger.error("[ingredient-photo] Failed to delete previous photo", {
        ingredientId: id,
        previousPathname,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    pathname: upload.pathname,
    contentType: photo.type,
    uploadedAt: upload.uploadedAt.toISOString(),
    size: upload.size,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "DEVELOPER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  const ingredient = await prisma.canonicalIngredient.findFirst({
    where: { id, accountId: session.user.accountId },
    select: { id: true, photoBlobPathname: true },
  })
  if (!ingredient) {
    return NextResponse.json({ error: "Ingredient not found" }, { status: 404 })
  }
  if (!ingredient.photoBlobPathname) {
    return NextResponse.json({ ok: true, removed: false })
  }

  const pathname = ingredient.photoBlobPathname
  await prisma.canonicalIngredient.update({
    where: { id: ingredient.id },
    data: {
      photoBlobPathname: null,
      photoContentType: null,
      photoUploadedAt: null,
    },
  })

  try {
    await deleteProductPhoto(pathname)
  } catch (err) {
    logger.error("[ingredient-photo] Failed to delete photo from R2", {
      ingredientId: id,
      pathname,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json({ ok: true, removed: true })
}
