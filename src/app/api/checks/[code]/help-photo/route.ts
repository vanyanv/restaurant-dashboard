import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { findStoreByCode } from "@/lib/checks/crew"
import { isHelpPhotoKey } from "@/lib/checks/help"
import { streamHelpPhoto } from "@/lib/checks/help-serve"

/**
 * A how-to reference photo on the crew page. Public like the page and its
 * list: the photo shows where things are in the store, and only a photo on a
 * task of this store's own checklists is served.
 */
const HELP_PHOTO_LIMIT = { limit: 120, windowMs: 60_000, identifyBy: "ip" as const }

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, HELP_PHOTO_LIMIT)
  if (limited) return limited
  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This link is no longer in use." }, { status: 404 })
  const key = request.nextUrl.searchParams.get("key") ?? ""
  if (!isHelpPhotoKey(store.accountId, key)) return NextResponse.json({ error: "Photo not found" }, { status: 404 })
  const item = await prisma.checkItem.findFirst({
    where: { helpPhotos: { has: key }, section: { template: { storeId: store.id, store: { accountId: store.accountId } } } },
    select: { id: true },
  })
  if (!item) return NextResponse.json({ error: "Photo not found" }, { status: 404 })
  return streamHelpPhoto(key)
}
