import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { isProductPhotoContentType, putCheckHelpPhoto } from "@/lib/blob"
import { streamHelpPhoto } from "@/lib/checks/help-serve"
import { isHelpPhotoKey } from "@/lib/checks/help"
import { looksLikeImage, MAX_PHOTO_BYTES } from "@/lib/checks/photo"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

/**
 * The owner's how-to reference photos for check tasks. POST stores one and
 * answers with its key; the checklist editor keeps the key and saves it with
 * the list. GET shows one back to the owner while editing. Crew load the
 * same photos through /api/checks/<code>/help-photo.
 */
export const maxDuration = 30

async function owner() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if (!hasOwnerAccess(session.user.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { accountId: session.user.accountId as string }
}

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited
  const who = await owner()
  if ("error" in who) return who.error

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "That photo didn't come through. Try again." }, { status: 400 })
  }
  const file = form.get("photo")
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo." }, { status: 400 })
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "That photo is too big. Try a smaller one." }, { status: 413 })
  const type = file.type || "image/jpeg"
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!isProductPhotoContentType(type) || !looksLikeImage(bytes.subarray(0, 12))) {
    return NextResponse.json({ error: "That isn't a photo we can show. Use a JPEG, PNG or WebP." }, { status: 415 })
  }
  try {
    const up = await putCheckHelpPhoto(who.accountId, bytes, type)
    return NextResponse.json({ key: up.pathname })
  } catch (err) {
    logger.error("[check-help-photo] upload failed", { message: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: "Photo storage is temporarily unavailable. Try again." }, { status: 503 })
  }
}

export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.beacon)
  if (limited) return limited
  const who = await owner()
  if ("error" in who) return who.error
  const key = request.nextUrl.searchParams.get("key") ?? ""
  if (!isHelpPhotoKey(who.accountId, key)) return NextResponse.json({ error: "Photo not found" }, { status: 404 })
  return streamHelpPhoto(key)
}
