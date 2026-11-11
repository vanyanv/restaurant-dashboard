import { prisma } from "@/lib/prisma"
import { cellStatus, type CellStatus, type PauseSpan } from "./status"
import { addDays, CHECK_KINDS, dayToDb, dbToDay, windowBounds, type CheckKindName, type CheckWindow } from "./time"
import { ensureCheckSetup } from "./setup"
import { AUTO_CLOSE_LOOKBACK_MS, autoCloseChecks, type AutoCloseCandidate } from "./close"

/**
 * The one loader behind Today, History and the missed-check alerts: every
 * active store in the account, by check, by business day, each cell
 * classified by `cellStatus`.
 */

export type GridSubmission = {
  id: string
  /** Who sent it; for a check that closed itself, everyone who ticked (may be empty). */
  crewName: string
  /** The app closed it when the window ended; nobody pressed Submit. */
  autoClosed: boolean
  /** Tasks done and on the list, from the record. */
  done: number
  total: number
  /** Tasks nobody ticked, in list order. Empty on a check crew sent. */
  missed: Array<{ section: string; item: string }>
  submittedAt: Date
  startedAt: Date | null
  lateMinutes: number
  flaggedCount: number
  flags: Array<{ section: string; item: string; note: string }>
  photos: Array<{ id: string; sectionName: string }>
}

/** One row of a check's log: a tick, an untick or a note, by whom and when. */
export type GridMark = {
  id: string
  itemId: string
  itemText: string
  sectionName: string
  done: boolean
  note: string | null
  crewName: string
  at: Date
  hasPhoto: boolean
}

export type GridCell = {
  day: string
  kind: CheckKindName
  status: CellStatus
  submission: GridSubmission | null
  /** First person to enter a PIN for a check not in yet. */
  startedBy: { name: string; at: Date } | null
  /** Every tick, untick and note, oldest first. */
  marks: GridMark[]
  /** Tasks done so far (the latest mark per task), out of the list's tasks. */
  done: number
  total: number
  /** Everyone who ticked a task or submitted, in the order they joined. */
  people: string[]
}

export type GridTemplate = CheckWindow & { id: string; kind: CheckKindName; enabled: boolean; createdAt: Date; itemCount: number }

export type GridStore = {
  id: string
  name: string
  /** Set to "Not open yet" in store settings: checks are paused, never missed. */
  preOpen: boolean
  /**
   * When the owner paused this store's checks to train crew, if they still
   * are. Set and cleared in Stores settings; see `CheckPause`.
   */
  pausedSince: Date | null
  templates: GridTemplate[]
  closedDays: string[]
  cells: GridCell[]
}

/** Latest mark per task, from a log in time order. */
export function currentMarks<M extends { itemId: string }>(marks: M[]): Map<string, M> {
  const out = new Map<string, M>()
  for (const m of marks) out.set(m.itemId, m)
  return out
}

/** Tasks on a record, tasks done, and the ones nobody ticked. */
export function recordCounts(content: unknown): { done: number; total: number; missed: GridSubmission["missed"] } {
  const c = content as SubmissionContent | null
  let done = 0
  let total = 0
  const missed: GridSubmission["missed"] = []
  for (const s of c?.sections ?? []) {
    for (const i of s.items ?? []) {
      total += 1
      if (i.done) done += 1
      else missed.push({ section: s.name, item: i.text })
    }
  }
  return { done, total, missed }
}

export type SubmissionContent = {
  sections: Array<{
    name: string
    photoRequired: boolean
    /** `by`, `at` and `photo` are on checks submitted from the shared form (2026-10-29 on). */
    items: Array<{ text: string; done: boolean; flag: string | null; by?: string | null; at?: string | null; photo?: boolean }>
  }>
}

export function flagsOf(content: unknown): GridSubmission["flags"] {
  const c = content as SubmissionContent | null
  const out: GridSubmission["flags"] = []
  for (const s of c?.sections ?? []) {
    for (const i of s.items ?? []) {
      if (i.flag) out.push({ section: s.name, item: i.text, note: i.flag })
    }
  }
  return out
}

export async function loadCheckGrid(opts: {
  accountId: string
  storeIds?: string[]
  fromDay: string
  toDay: string
  now: Date
  /**
   * Close any check whose window just ended with nothing sent (see
   * `close.ts`), then read again. On by default; the second read turns it off.
   */
  autoClose?: boolean
}): Promise<GridStore[]> {
  const stores = await prisma.store.findMany({
    where: {
      accountId: opts.accountId,
      isActive: true,
      ...(opts.storeIds ? { id: { in: opts.storeIds } } : {}),
    },
    select: { id: true, name: true, lifecycleStage: true },
    orderBy: { name: "asc" },
  })
  if (stores.length === 0) return []
  await Promise.all(stores.map((s) => ensureCheckSetup(s.id)))

  const storeIds = stores.map((s) => s.id)
  const range = { gte: dayToDb(opts.fromDay), lte: dayToDb(opts.toDay) }
  const [templates, submissions, closures, starts, marks, pauses] = await Promise.all([
    prisma.checkTemplate.findMany({
      where: { storeId: { in: storeIds }, store: { accountId: opts.accountId } },
      select: {
        id: true, storeId: true, kind: true, opensAtMin: true, submitFromMin: true, dueAtMin: true, dueByWeekday: true,
        graceMin: true, enabled: true, createdAt: true,
        sections: { select: { _count: { select: { items: true } } } },
      },
    }),
    prisma.checkSubmission.findMany({
      where: { storeId: { in: storeIds }, businessDate: range, store: { accountId: opts.accountId } },
      select: {
        id: true, storeId: true, kind: true, businessDate: true, crewName: true,
        submittedAt: true, startedAt: true, lateMinutes: true, flaggedCount: true, autoClosed: true, content: true,
        photos: { select: { id: true, sectionName: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.checkClosure.findMany({
      where: { storeId: { in: storeIds }, businessDate: range, store: { accountId: opts.accountId } },
      select: { storeId: true, businessDate: true },
    }),
    prisma.checkStart.findMany({
      where: { storeId: { in: storeIds }, businessDate: range, store: { accountId: opts.accountId } },
      select: {
        storeId: true, kind: true, businessDate: true, startedAt: true,
        crewMember: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.checkMark.findMany({
      where: { storeId: { in: storeIds }, businessDate: range, store: { accountId: opts.accountId } },
      select: {
        id: true, storeId: true, kind: true, businessDate: true, itemId: true, itemText: true, sectionName: true,
        done: true, note: true, crewName: true, at: true, photoKey: true,
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    }),
    // Every pause that could cover a window in range: one still on, or one
    // that ended after the range began.
    prisma.checkPause.findMany({
      where: {
        storeId: { in: storeIds },
        store: { accountId: opts.accountId },
        OR: [{ resumedAt: null }, { resumedAt: { gte: dayToDb(opts.fromDay) } }],
      },
      select: { storeId: true, pausedAt: true, resumedAt: true },
      orderBy: { pausedAt: "asc" },
    }),
  ])

  const days: string[] = []
  for (let d = opts.fromDay; d <= opts.toDay; d = addDays(d, 1)) days.push(d)

  const out = stores.map((store) => {
    const tpls = CHECK_KINDS.map((kind) => templates.find((t) => t.storeId === store.id && t.kind === kind))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({
        id: t.id,
        kind: t.kind as CheckKindName,
        opensAtMin: t.opensAtMin,
        submitFromMin: t.submitFromMin,
        dueAtMin: t.dueAtMin,
        dueByWeekday: t.dueByWeekday,
        graceMin: t.graceMin,
        enabled: t.enabled,
        createdAt: t.createdAt,
        itemCount: t.sections.reduce((n, s) => n + s._count.items, 0),
      }))
    const preOpen = store.lifecycleStage === "pre_open"
    const storePauses: PauseSpan[] = pauses
      .filter((p) => p.storeId === store.id)
      .map((p) => ({ pausedAt: p.pausedAt, resumedAt: p.resumedAt }))
    const pausedSince = storePauses.find((p) => p.resumedAt === null)?.pausedAt ?? null
    const closedDays = closures.filter((c) => c.storeId === store.id).map((c) => dbToDay(c.businessDate))
    const cells: GridCell[] = []
    for (const day of days) {
      for (const t of tpls) {
        const sub = submissions.find(
          (s) => s.storeId === store.id && s.kind === t.kind && dbToDay(s.businessDate) === day,
        )
        const start = starts.find(
          (s) => s.storeId === store.id && s.kind === t.kind && dbToDay(s.businessDate) === day,
        )
        const log: GridMark[] = marks
          .filter((m) => m.storeId === store.id && m.kind === t.kind && dbToDay(m.businessDate) === day)
          .map((m) => ({
            id: m.id,
            itemId: m.itemId,
            itemText: m.itemText,
            sectionName: m.sectionName,
            done: m.done,
            note: m.note,
            crewName: m.crewName,
            at: m.at,
            hasPhoto: Boolean(m.photoKey),
          }))
        const done = [...currentMarks(log).values()].filter((m) => m.done).length
        const rec = sub ? recordCounts(sub.content) : null
        // An auto-closed record names everyone who ticked; it is not a person.
        const people = [...new Set([...log.map((m) => m.crewName), ...(sub && !sub.autoClosed && sub.crewName ? [sub.crewName] : [])])]
        cells.push({
          day,
          kind: t.kind,
          marks: log,
          done: rec ? rec.done : done,
          total: rec ? rec.total : t.itemCount,
          people,
          status: cellStatus({
            day,
            window: t,
            enabled: t.enabled,
            // A store that isn't open yet has nothing to miss.
            closed: preOpen || closedDays.includes(day),
            submission: sub && rec ? { lateMinutes: sub.lateMinutes, done: rec.done, total: rec.total } : null,
            now: opts.now,
            since: t.createdAt,
            pauses: storePauses,
          }),
          submission: sub
            ? {
                id: sub.id,
                crewName: sub.crewName,
                autoClosed: sub.autoClosed,
                done: rec!.done,
                total: rec!.total,
                missed: rec!.missed,
                submittedAt: sub.submittedAt,
                startedAt: sub.startedAt,
                lateMinutes: sub.lateMinutes,
                flaggedCount: sub.flaggedCount,
                flags: flagsOf(sub.content),
                photos: sub.photos,
              }
            : null,
          startedBy: start
            ? { name: shortName(start.crewMember.firstName, start.crewMember.lastName), at: start.startedAt }
            : null,
        })
      }
    }
    return { id: store.id, name: store.name, preOpen, pausedSince, templates: tpls, closedDays, cells }
  })

  if (opts.autoClose === false) return out
  // A window that just ended with nothing sent: close it from the shared form,
  // then read again so every screen sees the record.
  let wrote = 0
  for (const store of out) {
    const candidates: AutoCloseCandidate[] = []
    for (const c of store.cells) {
      if (c.status !== "missed" || c.submission) continue
      const t = store.templates.find((x) => x.kind === c.kind)
      if (!t) continue
      const ended = opts.now.getTime() - windowBounds(c.day, t).closes.getTime()
      if (ended < 0 || ended > AUTO_CLOSE_LOOKBACK_MS) continue
      candidates.push({ kind: c.kind, day: c.day, window: t, templateId: t.id })
    }
    if (candidates.length === 0) continue
    wrote += await autoCloseChecks({ store: { id: store.id, accountId: opts.accountId }, candidates, now: opts.now })
  }
  return wrote > 0 ? loadCheckGrid({ ...opts, autoClose: false }) : out
}

/** "Maria G." */
export function shortName(first: string, last: string | null): string {
  const l = last?.trim()
  return l ? `${first.trim()} ${l[0].toUpperCase()}.` : first.trim()
}
