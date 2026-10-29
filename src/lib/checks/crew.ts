import { prisma } from "@/lib/prisma"
import { currentMarks, loadCheckGrid, type GridCell, type GridMark } from "./data"
import { ensureCheckSetup } from "./setup"
import {
  addDays,
  CHECK_KINDS,
  CHECK_LABEL,
  clockLabel,
  dueAtFor,
  minutesLabel,
  submitFromFor,
  todayLA,
  visibleDay,
  windowBounds,
  windowPhase,
  type CheckKindName,
} from "./time"
import type { CellStatus } from "./status"

/**
 * What the crew page shows, computed on the server. The page, the PIN step
 * and the submit step all come through here, so a check the page offers is
 * exactly a check the submit will take.
 */

export type CrewStore = { id: string; name: string; accountId: string }

export async function findStoreByCode(code: string): Promise<CrewStore | null> {
  if (!/^[a-z0-9-]{3,64}$/.test(code)) return null
  return prisma.store.findFirst({
    where: { checkCode: code, isActive: true },
    select: { id: true, name: true, accountId: true },
  })
}

export type CrewDayRow = {
  kind: CheckKindName
  label: { en: string; es: string }
  /** "9:00 am", when crew can open the list. */
  opensLabel: string
  /** "4:30 – 5:30 pm", when Submit is open, for this row's day. */
  submitLabel: string
  status: CellStatus
  doneBy: string | null
  doneAt: string | null
  late: number
}

export type CrewItem = { id: string; en: string; es: string | null; photoRequired: boolean }
export type CrewSection = {
  id: string
  en: string
  es: string | null
  items: CrewItem[]
}

/** A task's state on the shared form: the latest tick, untick or note. */
export type CrewMarkState = {
  itemId: string
  done: boolean
  note: string | null
  by: string
  /** "9:41 am". */
  at: string
  hasPhoto: boolean
}

export type ActiveCheck = {
  kind: CheckKindName
  day: string
  label: { en: string; es: string }
  /** Epoch ms. */
  submitFrom: number
  dueAt: number
  closesAt: number
  /** Submit is unlocked now. Before `submitFrom` crew can still tick tasks. */
  canSubmit: boolean
  submitFromLabel: string
  dueLabel: string
  sections: CrewSection[]
  marks: CrewMarkState[]
  /** Everyone who has ticked something, in the order they joined. */
  people: string[]
}

export type CrewView = {
  store: { name: string }
  day: string
  rows: CrewDayRow[]
  active: ActiveCheck | null
  next: { label: { en: string; es: string }; opensLabel: string } | null
  closedToday: boolean
  serverNow: number
}

export async function loadCrewView(store: CrewStore, now: Date): Promise<CrewView> {
  await ensureCheckSetup(store.id)
  const today = todayLA(now)
  const [grid] = await loadCheckGrid({
    accountId: store.accountId,
    storeIds: [store.id],
    fromDay: addDays(today, -1),
    toDay: today,
    now,
  })
  const templates = grid?.templates ?? []
  const cellFor = (kind: CheckKindName, day: string): GridCell | undefined =>
    grid?.cells.find((c) => c.kind === kind && c.day === day)

  // The check crew can work on now: a night still open past midnight belongs
  // to yesterday, so the day comes from the window.
  let active: { kind: CheckKindName; day: string; cell: GridCell } | null = null
  for (const t of templates) {
    if (!t.enabled) continue
    const day = visibleDay(t, now)
    if (!day) continue
    const cell = cellFor(t.kind, day)
    if (cell && cell.status === "open") {
      active = { kind: t.kind, day, cell }
      break
    }
  }

  const rows: CrewDayRow[] = CHECK_KINDS.flatMap((kind) => {
    const t = templates.find((x) => x.kind === kind)
    if (!t || !t.enabled) return []
    // Before the morning opens, last night's row is the one still worth showing.
    const day = active?.kind === kind ? active.day : today
    const cell = cellFor(kind, day)
    return [{
      kind,
      label: CHECK_LABEL[kind],
      opensLabel: minutesLabel(t.opensAtMin),
      submitLabel: `${minutesLabel(submitFromFor(t))} – ${minutesLabel(dueAtFor(day, t))}`,
      status: cell?.status ?? "upcoming",
      doneBy: cell?.submission?.crewName ?? null,
      doneAt: cell?.submission ? clockLabel(cell.submission.submittedAt) : null,
      late: cell?.submission?.lateMinutes ?? 0,
    }]
  })

  let activeCheck: ActiveCheck | null = null
  if (active) {
    const t = templates.find((x) => x.kind === active!.kind)!
    const b = windowBounds(active.day, t)
    const phase = windowPhase(active.day, t, now)
    activeCheck = {
      kind: active.kind,
      day: active.day,
      label: CHECK_LABEL[active.kind],
      submitFrom: b.submitFrom.getTime(),
      dueAt: b.due.getTime(),
      closesAt: b.closes.getTime(),
      canSubmit: phase === "open" || phase === "late",
      submitFromLabel: minutesLabel(submitFromFor(t)),
      dueLabel: minutesLabel(dueAtFor(active.day, t)),
      sections: await loadSections(store.id, active.kind),
      marks: markStates(active.cell.marks),
      people: active.cell.people,
    }
  }

  const upcoming = rows.find((r) => r.status === "upcoming")

  return {
    store: { name: store.name },
    day: today,
    rows,
    active: activeCheck,
    next: upcoming ? { label: upcoming.label, opensLabel: upcoming.opensLabel } : null,
    closedToday: (grid?.preOpen ?? false) || (grid?.closedDays.includes(today) ?? false),
    serverNow: now.getTime(),
  }
}

export function markStates(log: GridMark[]): CrewMarkState[] {
  return [...currentMarks(log).values()].map((m) => ({
    itemId: m.itemId,
    done: m.done,
    note: m.note,
    by: m.crewName,
    at: clockLabel(m.at),
    hasPhoto: m.hasPhoto,
  }))
}

export async function loadSections(storeId: string, kind: CheckKindName): Promise<CrewSection[]> {
  const tpl = await prisma.checkTemplate.findUnique({
    where: { storeId_kind: { storeId, kind } },
    select: {
      sections: {
        orderBy: { position: "asc" },
        select: {
          id: true, nameEn: true, nameEs: true,
          items: { orderBy: { position: "asc" }, select: { id: true, textEn: true, textEs: true, photoRequired: true } },
        },
      },
    },
  })
  return (tpl?.sections ?? [])
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      id: s.id,
      en: s.nameEn,
      es: s.nameEs,
      items: s.items.map((i) => ({ id: i.id, en: i.textEn, es: i.textEs, photoRequired: i.photoRequired })),
    }))
}

/** The public link printed on a store's poster. */
export function checkLink(code: string): string {
  const base =
    process.env.CHECKS_BASE_URL ??
    `${(process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")}/checks`
  return `${base.replace(/\/$/, "")}/${code}`
}
