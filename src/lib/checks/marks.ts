import { prisma } from "@/lib/prisma"
import { currentMarks, shortName, type SubmissionContent } from "./data"
import { readCrewPass } from "./crew-session"
import type { ActiveCheck, CrewStore } from "./crew"
import { dayToDb } from "./time"

/**
 * The shared live form behind a check. Every tick, untick and note is a
 * `CheckMark` row; the latest row per task is that task's state. Several crew
 * can work on one check at once, and submit reads the form from these rows
 * rather than from whichever phone pressed the button.
 */

export type PassCrew = { id: string; name: string; firstName: string; kind: string; day: string }

/** The crew member a pass names, if the pass is good for this store and they are still on. */
export async function crewFromPass(store: CrewStore, token: string): Promise<PassCrew | null> {
  const pass = readCrewPass(token)
  if (!pass || pass.storeId !== store.id) return null
  const crew = await prisma.crewMember.findFirst({
    where: { id: pass.crewMemberId, storeId: store.id, active: true, store: { accountId: store.accountId } },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!crew) return null
  return { id: crew.id, name: shortName(crew.firstName, crew.lastName), firstName: crew.firstName, kind: pass.kind, day: pass.day }
}

export type MarkRow = {
  itemId: string
  itemText: string
  sectionName: string
  done: boolean
  note: string | null
  crewName: string
  at: Date
  photoKey: string | null
  photoType: string | null
  photoSize: number | null
}

export async function loadMarkRows(store: CrewStore, kind: ActiveCheck["kind"], day: string): Promise<MarkRow[]> {
  return prisma.checkMark.findMany({
    where: { storeId: store.id, kind, businessDate: dayToDb(day), store: { accountId: store.accountId } },
    select: {
      itemId: true, itemText: true, sectionName: true, done: true, note: true, crewName: true, at: true,
      photoKey: true, photoType: true, photoSize: true,
    },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  })
}

export type FormProblem = { error: string }

export type FormSnapshot = {
  content: SubmissionContent
  flagged: number
  photos: Array<{ sectionName: string; storageKey: string; contentType: string; size: number }>
  firstAt: Date | null
}

/**
 * The form as it stands, checked against the CURRENT checklist: every task
 * done (a note counts), and every photo task carrying its photo. Returns the
 * first thing still missing, in words crew can act on.
 */
export function snapshotForm(active: ActiveCheck, rows: MarkRow[]): FormSnapshot | FormProblem {
  const state = currentMarks(rows)
  const content: SubmissionContent = { sections: [] }
  const photos: FormSnapshot["photos"] = []
  let flagged = 0
  let left = 0
  let photosLeft = 0
  for (const s of active.sections) {
    const items = s.items.map((i) => {
      const m = state.get(i.id)
      const done = Boolean(m?.done)
      if (!done) left += 1
      else if (i.photoRequired && !m?.photoKey && !m?.note) photosLeft += 1
      if (done && m?.note) flagged += 1
      if (done && m?.photoKey) {
        photos.push({ sectionName: i.en, storageKey: m.photoKey, contentType: m.photoType ?? "image/jpeg", size: m.photoSize ?? 0 })
      }
      return {
        text: i.en,
        done,
        flag: done ? m?.note ?? null : null,
        by: m?.crewName ?? null,
        at: m ? m.at.toISOString() : null,
        photo: Boolean(done && m?.photoKey),
      }
    })
    content.sections.push({ name: s.en, photoRequired: false, items })
  }
  if (left > 0) return { error: `${left} task${left === 1 ? "" : "s"} still to do.` }
  if (photosLeft > 0) return { error: `${photosLeft} photo${photosLeft === 1 ? "" : "s"} still needed.` }
  return { content, flagged, photos, firstAt: rows[0]?.at ?? null }
}
