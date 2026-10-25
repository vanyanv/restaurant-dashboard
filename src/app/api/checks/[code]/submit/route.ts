import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { deleteCheckPhoto, isProductPhotoContentType, putCheckPhoto } from "@/lib/blob"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { readCrewPass } from "@/lib/checks/crew-session"
import { shortName, type SubmissionContent } from "@/lib/checks/data"
import { isUniqueViolation } from "@/lib/checks/setup"
import { clockLabel, dayToDb, lateMinutes } from "@/lib/checks/time"
import { logger } from "@/lib/logger"

/**
 * Crew submit. Everything is checked again here rather than trusted from the
 * page: the pass, that the same check is still open, that every item is
 * ticked or flagged against the CURRENT checklist, and that every required
 * photo is attached.
 *
 * The submission row is written before the photos upload, because its unique
 * key (store, check, day) is the lock: of two phones submitting at once,
 * exactly one gets the row. If an upload then fails, the row is removed so
 * the person can try again.
 */
export const maxDuration = 30

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
/**
 * The whole upload. Vercel refuses a function body past about 4.5 MB before
 * this code runs; checking first turns that into words crew can act on. The
 * phone shrinks each photo to 1600 px JPEG, a few hundred KB.
 */
const MAX_BODY_BYTES = 4_400_000
const MAX_NOTE = 200

/** The first bytes of a JPEG, PNG or WebP. The declared type alone is the client's word. */
function looksLikeImage(head: Uint8Array): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, j) => head[i + j] === v)
  return at(0, 0xff, 0xd8, 0xff) || at(0, 0x89, 0x50, 0x4e, 0x47) || (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
}

type Answer = { done?: boolean; flag?: string | null }

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This QR code is no longer in use." }, { status: 404 })

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "The photos are too large together. Take them again." }, { status: 413 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "The upload didn't come through. Try again." }, { status: 400 })
  }

  const pass = readCrewPass(String(form.get("pass") ?? ""))
  if (!pass || pass.storeId !== store.id) {
    return NextResponse.json({ error: "Your PIN has timed out. Enter it again." }, { status: 401 })
  }

  const crew = await prisma.crewMember.findFirst({
    where: { id: pass.crewMemberId, storeId: store.id, active: true },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!crew) return NextResponse.json({ error: "Your PIN has been turned off." }, { status: 401 })

  const now = new Date()
  const view = await loadCrewView(store, now)
  const active = view.active
  if (!active || active.kind !== pass.kind || active.day !== pass.day) {
    const already = await prisma.checkSubmission.findUnique({
      where: { storeId_kind_businessDate: { storeId: store.id, kind: pass.kind as never, businessDate: dayToDb(pass.day) } },
      select: { crewName: true, submittedAt: true },
    })
    return NextResponse.json(
      {
        error: already
          ? `${already.crewName} already submitted this check at ${clockLabel(already.submittedAt)}.`
          : "This check has closed.",
      },
      { status: 409 },
    )
  }

  let answers: Record<string, Answer>
  try {
    answers = JSON.parse(String(form.get("answers") ?? "{}")) as Record<string, Answer>
  } catch {
    return NextResponse.json({ error: "Something was wrong with the checklist. Reload and try again." }, { status: 400 })
  }

  const content: SubmissionContent = { sections: [] }
  const photos: Array<{ sectionName: string; file: File }> = []
  let flagged = 0
  for (const s of active.sections) {
    const items = s.items.map((i) => {
      const a = answers[i.id] ?? {}
      const flag = typeof a.flag === "string" && a.flag.trim() ? a.flag.trim().slice(0, MAX_NOTE) : null
      if (flag) flagged += 1
      return { text: i.en, done: a.done === true || flag !== null, flag }
    })
    const missing = items.filter((i) => !i.done).length
    if (missing > 0) {
      return NextResponse.json(
        { error: `${s.en}: ${missing} item${missing === 1 ? "" : "s"} still to do.` },
        { status: 400 },
      )
    }
    const file = form.get(`photo_${s.id}`)
    if (s.photoRequired) {
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: `${s.en} photo is still needed.` }, { status: 400 })
      }
    }
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: `${s.en} photo is too large. Take it again.` }, { status: 400 })
      }
      if (!isProductPhotoContentType(file.type) || !looksLikeImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) {
        return NextResponse.json({ error: `${s.en} photo isn't an image the dashboard can store.` }, { status: 400 })
      }
      photos.push({ sectionName: s.en, file })
    }
    content.sections.push({ name: s.en, photoRequired: s.photoRequired, items })
  }

  const extraKeys = Object.keys(answers).filter(
    (id) => !active.sections.some((s) => s.items.some((i) => i.id === id)),
  )
  if (extraKeys.length > 0) {
    return NextResponse.json(
      { error: "The checklist changed while you were working. Reload to see the new one." },
      { status: 409 },
    )
  }

  const startedRaw = Number(form.get("startedAt"))
  const startedAt = Number.isFinite(startedRaw) && startedRaw > 0 && startedRaw <= now.getTime()
    ? new Date(startedRaw)
    : null
  const tpl = await prisma.checkTemplate.findUnique({
    where: { storeId_kind: { storeId: store.id, kind: active.kind } },
    select: { id: true, opensAtMin: true, dueAtMin: true, graceMin: true },
  })
  if (!tpl) return NextResponse.json({ error: "This check has closed." }, { status: 409 })

  const crewName = shortName(crew.firstName, crew.lastName)
  let submissionId: string
  try {
    const created = await prisma.checkSubmission.create({
      data: {
        storeId: store.id,
        templateId: tpl.id,
        kind: active.kind,
        businessDate: dayToDb(active.day),
        crewMemberId: crew.id,
        crewName,
        startedAt,
        submittedAt: now,
        lateMinutes: lateMinutes(active.day, tpl, now),
        flaggedCount: flagged,
        content,
      },
      select: { id: true },
    })
    submissionId = created.id
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Someone else just submitted this check." }, { status: 409 })
    }
    throw err
  }

  const uploaded: string[] = []
  try {
    for (const p of photos) {
      const bytes = Buffer.from(await p.file.arrayBuffer())
      const up = await putCheckPhoto(store.id, bytes, p.file.type as "image/jpeg")
      uploaded.push(up.pathname)
      await prisma.checkPhoto.create({
        data: {
          submissionId,
          sectionName: p.sectionName,
          storageKey: up.pathname,
          contentType: p.file.type,
          size: up.size,
        },
      })
    }
  } catch (err) {
    logger.error("[checks.submit] photo upload failed", {
      storeId: store.id,
      message: err instanceof Error ? err.message : String(err),
    })
    await prisma.checkSubmission.delete({ where: { id: submissionId } }).catch(() => undefined)
    await Promise.all(uploaded.map((key) => deleteCheckPhoto(key).catch(() => undefined)))
    return NextResponse.json(
      { error: "The photos didn't upload. Nothing was submitted. Try again." },
      { status: 502 },
    )
  }

  const late = lateMinutes(active.day, tpl, now)
  return NextResponse.json({
    ok: true,
    receipt: {
      store: store.name,
      check: active.label,
      day: active.day,
      at: clockLabel(now),
      by: crewName,
      late,
      dueLabel: active.dueLabel,
      flagged,
      next: view.next,
    },
  })
}
