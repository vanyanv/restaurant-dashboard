import { after } from "next/server"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { CrewSection } from "./crew"
import { currentMarks, type SubmissionContent } from "./data"
import { loadSections } from "./sections"
import { isUniqueViolation } from "./setup"
import { dayToDb, lateMinutes, windowBounds, type CheckKindName, type CheckWindow } from "./time"

/**
 * Checks close themselves. When a check's window ends (due time plus grace)
 * and nobody pressed Submit, the app writes the check's record from the
 * shared form as it stood: every ticked task is done, with who ticked it and
 * when, and every task nobody ticked is recorded as missed. Then the owners
 * get the same email a crew submit sends, listing both.
 *
 * It runs inside `loadCheckGrid`, so every screen that reads checks (Today,
 * History, the crew page, Needs you, the cron, the chat) closes a finished
 * window the first time it looks, and none of them depends on the cron being
 * on time. The record's unique key (store, check, day) means a crew submit
 * and an auto-close, or two loaders at once, can never both write one.
 */

/** Only windows that ended this recently are closed; older misses stay as they were. */
export const AUTO_CLOSE_LOOKBACK_MS = 48 * 60 * 60_000

/** The owners are emailed only about a window that ended this recently, so a deploy never sends a pile of old news. */
export const AUTO_CLOSE_EMAIL_MS = 12 * 60 * 60_000

/** The shape `closedForm` reads: one tick, untick or note. */
export type CloseMark = {
  itemId: string
  done: boolean
  note: string | null
  crewName: string
  at: Date
  photoKey: string | null
  photoType: string | null
  photoSize: number | null
}

export type ClosedForm = {
  content: SubmissionContent
  done: number
  total: number
  flagged: number
  photos: Array<{ sectionName: string; storageKey: string; contentType: string; size: number }>
  /** First tick of any kind. */
  firstAt: Date | null
  /** The latest tick among the tasks that ended up done. */
  lastDoneAt: Date | null
  /** Everyone whose mark is the one that stands on a done task, in the order they first ticked. */
  people: string[]
}

/**
 * The form as it stood when the window ended, against the CURRENT checklist.
 * Unlike a crew submit nothing is refused: a task nobody ticked is kept with
 * `done: false`, which is what makes it a missed task.
 */
export function closedForm(sections: CrewSection[], rows: CloseMark[]): ClosedForm {
  const state = currentMarks(rows)
  const content: SubmissionContent = { sections: [] }
  const photos: ClosedForm["photos"] = []
  const people: string[] = []
  let done = 0
  let total = 0
  let flagged = 0
  let lastDoneAt: Date | null = null
  for (const s of sections) {
    const items = s.items.map((i) => {
      total += 1
      const m = state.get(i.id)
      const isDone = Boolean(m?.done)
      if (isDone && m) {
        done += 1
        if (m.note) flagged += 1
        if (!lastDoneAt || m.at.getTime() > lastDoneAt.getTime()) lastDoneAt = m.at
        if (m.photoKey) photos.push({ sectionName: i.en, storageKey: m.photoKey, contentType: m.photoType ?? "image/jpeg", size: m.photoSize ?? 0 })
      }
      return {
        text: i.en,
        done: isDone,
        flag: isDone ? m?.note ?? null : null,
        by: isDone ? m?.crewName ?? null : null,
        at: isDone && m ? m.at.toISOString() : null,
        photo: Boolean(isDone && m?.photoKey),
      }
    })
    content.sections.push({ name: s.en, photoRequired: false, items })
  }
  // In the order people first ticked, among those whose tick stands.
  const standing = new Set(content.sections.flatMap((s) => s.items.flatMap((i) => (i.by ? [i.by] : []))))
  for (const r of rows) if (standing.has(r.crewName) && !people.includes(r.crewName)) people.push(r.crewName)
  return { content, done, total, flagged, photos, firstAt: rows[0]?.at ?? null, lastDoneAt, people }
}

export type AutoCloseCandidate = { kind: CheckKindName; day: string; window: CheckWindow; templateId: string }

/**
 * Writes the record for each check whose window has ended with nothing sent.
 * The caller decides which checks qualify (`loadCheckGrid` passes the cells it
 * classified as missed). Returns how many it wrote.
 */
export async function autoCloseChecks(opts: {
  store: { id: string; accountId: string }
  candidates: AutoCloseCandidate[]
  now: Date
}): Promise<number> {
  let written = 0
  for (const c of opts.candidates) {
    const closes = windowBounds(c.day, c.window).closes
    const sections = await loadSections(opts.store.id, c.kind)
    const rows = await prisma.checkMark.findMany({
      where: { storeId: opts.store.id, kind: c.kind, businessDate: dayToDb(c.day), store: { accountId: opts.store.accountId } },
      select: { itemId: true, done: true, note: true, crewName: true, at: true, photoKey: true, photoType: true, photoSize: true },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    })
    // A mark made after the window ended (a phone that was offline) never counts.
    const inWindow = rows.filter((r) => r.at.getTime() <= closes.getTime())
    const form = closedForm(sections, inWindow)
    // An empty list has nothing to close; it stays as it is.
    if (form.total === 0) continue
    const complete = form.done === form.total
    let id: string
    try {
      const created = await prisma.checkSubmission.create({
        data: {
          storeId: opts.store.id,
          templateId: c.templateId,
          kind: c.kind,
          businessDate: dayToDb(c.day),
          crewMemberId: null,
          crewName: form.people.join(", "),
          startedAt: form.firstAt,
          submittedAt: closes,
          lateMinutes: complete && form.lastDoneAt ? lateMinutes(c.day, c.window, form.lastDoneAt) : 0,
          flaggedCount: form.flagged,
          autoClosed: true,
          content: form.content,
          photos: { create: form.photos },
        },
        select: { id: true },
      })
      id = created.id
    } catch (err) {
      // Crew or another loader got there first: their record stands.
      if (isUniqueViolation(err)) continue
      throw err
    }
    written += 1
    if (opts.now.getTime() - closes.getTime() <= AUTO_CLOSE_EMAIL_MS) afterResponse(() => emailReport(id))
  }
  return written
}

async function emailReport(id: string): Promise<void> {
  try {
    // Imported here: report.ts reads the grid's types, and the grid calls this file.
    const { sendCheckReport } = await import("./report")
    await sendCheckReport(id)
  } catch (err) {
    logger.error("[checks.close] report email failed", { submissionId: id, message: err instanceof Error ? err.message : String(err) })
  }
}

/** Runs `fn` after the response when there is one (a page, a route), else straight away. */
function afterResponse(fn: () => Promise<void>): void {
  try {
    after(fn)
  } catch {
    void fn()
  }
}
