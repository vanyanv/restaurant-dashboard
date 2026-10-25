import { prisma } from "@/lib/prisma"
import { cellStatus, type CellStatus } from "./status"
import { addDays, CHECK_KINDS, dayToDb, dbToDay, type CheckKindName, type CheckWindow } from "./time"
import { ensureCheckSetup } from "./setup"

/**
 * The one loader behind Today, History and the missed-check alerts: every
 * active store in the account, by check, by business day, each cell
 * classified by `cellStatus`.
 */

export type GridSubmission = {
  id: string
  crewName: string
  submittedAt: Date
  startedAt: Date | null
  lateMinutes: number
  flaggedCount: number
  flags: Array<{ section: string; item: string; note: string }>
  photos: Array<{ id: string; sectionName: string }>
}

export type GridCell = {
  day: string
  kind: CheckKindName
  status: CellStatus
  submission: GridSubmission | null
  /** First person to enter a PIN for a check not in yet. */
  startedBy: { name: string; at: Date } | null
}

export type GridTemplate = CheckWindow & { kind: CheckKindName; enabled: boolean; createdAt: Date }

export type GridStore = {
  id: string
  name: string
  templates: GridTemplate[]
  closedDays: string[]
  cells: GridCell[]
}

export type SubmissionContent = {
  sections: Array<{
    name: string
    photoRequired: boolean
    items: Array<{ text: string; done: boolean; flag: string | null }>
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
}): Promise<GridStore[]> {
  const stores = await prisma.store.findMany({
    where: {
      accountId: opts.accountId,
      isActive: true,
      ...(opts.storeIds ? { id: { in: opts.storeIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  if (stores.length === 0) return []
  await Promise.all(stores.map((s) => ensureCheckSetup(s.id)))

  const storeIds = stores.map((s) => s.id)
  const range = { gte: dayToDb(opts.fromDay), lte: dayToDb(opts.toDay) }
  const [templates, submissions, closures, starts] = await Promise.all([
    prisma.checkTemplate.findMany({
      where: { storeId: { in: storeIds }, store: { accountId: opts.accountId } },
      select: { storeId: true, kind: true, opensAtMin: true, dueAtMin: true, graceMin: true, enabled: true, createdAt: true },
    }),
    prisma.checkSubmission.findMany({
      where: { storeId: { in: storeIds }, businessDate: range, store: { accountId: opts.accountId } },
      select: {
        id: true, storeId: true, kind: true, businessDate: true, crewName: true,
        submittedAt: true, startedAt: true, lateMinutes: true, flaggedCount: true, content: true,
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
  ])

  const days: string[] = []
  for (let d = opts.fromDay; d <= opts.toDay; d = addDays(d, 1)) days.push(d)

  return stores.map((store) => {
    const tpls = CHECK_KINDS.map((kind) => templates.find((t) => t.storeId === store.id && t.kind === kind))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({
        kind: t.kind as CheckKindName,
        opensAtMin: t.opensAtMin,
        dueAtMin: t.dueAtMin,
        graceMin: t.graceMin,
        enabled: t.enabled,
        createdAt: t.createdAt,
      }))
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
        cells.push({
          day,
          kind: t.kind,
          status: cellStatus({
            day,
            window: t,
            enabled: t.enabled,
            closed: closedDays.includes(day),
            submission: sub ?? null,
            now: opts.now,
            since: t.createdAt,
          }),
          submission: sub
            ? {
                id: sub.id,
                crewName: sub.crewName,
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
    return { id: store.id, name: store.name, templates: tpls, closedDays, cells }
  })
}

/** "Maria G." */
export function shortName(first: string, last: string | null): string {
  const l = last?.trim()
  return l ? `${first.trim()} ${l[0].toUpperCase()}.` : first.trim()
}
