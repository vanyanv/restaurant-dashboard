import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { isProductPhotoContentType, putCheckPhoto } from "@/lib/blob"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { crewFromPass } from "@/lib/checks/marks"
import { dayToDb } from "@/lib/checks/time"
import { looksLikeImage, MAX_PHOTO_BYTES } from "@/lib/checks/photo"

/**
 * One tick, untick or note on the shared form, saved the moment crew tap.
 * Several people can work on the same check: each row carries who and when,
 * and everyone's phone picks it up on its next refresh.
 *
 * A photo task takes its photo here, with the tick, so the form on the
 * server is always the whole truth and submit uploads nothing.
 */
export const maxDuration = 30

/** A crew of four ticking fast on one store Wi-Fi stays well under this. */
const MARK_LIMIT = { limit: 120, windowMs: 60_000, identifyBy: "ip" as const }
const MAX_NOTE = 200

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, MARK_LIMIT)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This link is no longer in use." }, { status: 404 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "That didn't come through. Try again." }, { status: 400 })
  }

  const crew = await crewFromPass(store, String(form.get("pass") ?? ""))
  if (!crew) return NextResponse.json({ error: "Your PIN has timed out. Enter it again." }, { status: 401 })

  const now = new Date()
  const view = await loadCrewView(store, now)
  const active = view.active
  if (!active || active.kind !== crew.kind || active.day !== crew.day) {
    return NextResponse.json({ error: "This check is closed or already submitted.", view }, { status: 409 })
  }

  const itemId = String(form.get("itemId") ?? "")
  const section = active.sections.find((s) => s.items.some((i) => i.id === itemId))
  const item = section?.items.find((i) => i.id === itemId)
  if (!section || !item) {
    return NextResponse.json({ error: "The checklist changed. Here is the new one.", view }, { status: 409 })
  }

  const done = form.get("done") === "1"
  const rawNote = form.get("note")
  const note = done && typeof rawNote === "string" && rawNote.trim() ? rawNote.trim().slice(0, MAX_NOTE) : null
  const file = form.get("photo")
  const hasFile = file instanceof File && file.size > 0
  if (done && item.photoRequired && !hasFile && !note) {
    return NextResponse.json({ error: "Take a photo to finish this task." }, { status: 400 })
  }

  let photo: { key: string; type: string; size: number } | null = null
  if (done && hasFile) {
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "That photo is too large. Take it again." }, { status: 400 })
    }
    if (!isProductPhotoContentType(file.type) || !looksLikeImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
      return NextResponse.json({ error: "That photo isn't an image the dashboard can store." }, { status: 400 })
    }
    try {
      const up = await putCheckPhoto(store.id, Buffer.from(await file.arrayBuffer()), file.type)
      photo = { key: up.pathname, type: file.type, size: up.size }
    } catch {
      return NextResponse.json({ error: "The photo didn't upload. Try again." }, { status: 502 })
    }
  }

  await prisma.checkMark.create({
    data: {
      storeId: store.id,
      kind: active.kind,
      businessDate: dayToDb(active.day),
      itemId: item.id,
      itemText: item.en,
      sectionName: section.en,
      done,
      note,
      crewMemberId: crew.id,
      crewName: crew.name,
      at: now,
      photoKey: photo?.key ?? null,
      photoType: photo?.type ?? null,
      photoSize: photo?.size ?? null,
    },
  })

  return NextResponse.json({ ok: true, view: await loadCrewView(store, new Date()) })
}
