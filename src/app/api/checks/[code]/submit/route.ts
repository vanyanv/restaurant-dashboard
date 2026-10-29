import { after, NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { crewFromPass, loadMarkRows, snapshotForm } from "@/lib/checks/marks"
import { sendCheckReport } from "@/lib/checks/report"
import { isUniqueViolation } from "@/lib/checks/setup"
import { clockLabel, dayToDb, lateMinutes } from "@/lib/checks/time"
import { logger } from "@/lib/logger"

/**
 * Crew submit. The form is read from the shared marks on the server, not
 * from the phone, so whoever presses Submit sends what everyone did. Checked
 * again here: the pass, that Submit is open for this check, that every task
 * is done against the CURRENT checklist, and that every photo task has its
 * photo (the photos were uploaded with their ticks).
 *
 * The submission row's unique key (store, check, day) is the lock: of two
 * phones submitting at once, exactly one gets the row.
 */
export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.moderate)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This link is no longer in use." }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { pass?: unknown } | null
  const crew = await crewFromPass(store, typeof body?.pass === "string" ? body.pass : "")
  if (!crew) return NextResponse.json({ error: "Your PIN has timed out. Enter it again." }, { status: 401 })

  const now = new Date()
  const view = await loadCrewView(store, now)
  const active = view.active
  if (!active || active.kind !== crew.kind || active.day !== crew.day) {
    const already = await prisma.checkSubmission.findUnique({
      where: { storeId_kind_businessDate: { storeId: store.id, kind: crew.kind as never, businessDate: dayToDb(crew.day) } },
      select: { crewName: true, submittedAt: true },
    })
    return NextResponse.json(
      {
        error: already
          ? `${already.crewName} already submitted this check at ${clockLabel(already.submittedAt)}.`
          : "This check has closed.",
        view,
      },
      { status: 409 },
    )
  }
  if (!active.canSubmit) {
    return NextResponse.json({ error: `Submit opens at ${active.submitFromLabel}.`, view }, { status: 409 })
  }

  const rows = await loadMarkRows(store, active.kind, active.day)
  const form = snapshotForm(active, rows)
  if ("error" in form) return NextResponse.json({ error: form.error, view }, { status: 400 })

  const tpl = await prisma.checkTemplate.findUnique({
    where: { storeId_kind: { storeId: store.id, kind: active.kind } },
    select: { id: true, opensAtMin: true, submitFromMin: true, dueAtMin: true, dueByWeekday: true, graceMin: true },
  })
  if (!tpl) return NextResponse.json({ error: "This check has closed." }, { status: 409 })

  const late = lateMinutes(active.day, tpl, now)
  let submissionId: string
  try {
    const created = await prisma.checkSubmission.create({
      data: {
        storeId: store.id,
        templateId: tpl.id,
        kind: active.kind,
        businessDate: dayToDb(active.day),
        crewMemberId: crew.id,
        crewName: crew.name,
        startedAt: form.firstAt,
        submittedAt: now,
        lateMinutes: late,
        flaggedCount: form.flagged,
        content: form.content,
        photos: { create: form.photos },
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

  // The owners' email goes after the response, so a slow mail service never
  // holds a crew member's phone.
  after(async () => {
    try {
      await sendCheckReport(submissionId)
    } catch (err) {
      logger.error("[checks.submit] report email failed", {
        storeId: store.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  return NextResponse.json({
    ok: true,
    receipt: {
      store: store.name,
      check: active.label,
      day: active.day,
      at: clockLabel(now),
      by: crew.name,
      late,
      dueLabel: active.dueLabel,
      flagged: form.flagged,
      tasks: form.content.sections.reduce((n, s) => n + s.items.length, 0),
      photos: form.photos.length,
      people: active.people,
      next: view.next,
    },
  })
}
