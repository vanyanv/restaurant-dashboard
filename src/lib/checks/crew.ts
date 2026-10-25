import { prisma } from "@/lib/prisma"
import { loadCheckGrid, type GridCell } from "./data"
import { ensureCheckSetup } from "./setup"
import {
  acceptingDay,
  addDays,
  CHECK_KINDS,
  CHECK_LABEL,
  clockLabel,
  minutesLabel,
  todayLA,
  windowBounds,
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
  windowLabel: string
  status: CellStatus
  doneBy: string | null
  doneAt: string | null
  late: number
}

export type CrewItem = { id: string; en: string; es: string | null }
export type CrewSection = {
  id: string
  en: string
  es: string | null
  photoRequired: boolean
  hintEn: string | null
  hintEs: string | null
  items: CrewItem[]
}

export type ActiveCheck = {
  kind: CheckKindName
  day: string
  label: { en: string; es: string }
  dueAt: number
  closesAt: number
  dueLabel: string
  sections: CrewSection[]
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

  // The check taking submissions now: an evening still open past midnight
  // belongs to yesterday, so the accepting day comes from the window.
  let active: { kind: CheckKindName; day: string } | null = null
  for (const t of templates) {
    if (!t.enabled) continue
    const day = acceptingDay(t, now)
    if (!day) continue
    const cell = cellFor(t.kind, day)
    if (cell && cell.status === "open") {
      active = { kind: t.kind, day }
      break
    }
  }

  const rows: CrewDayRow[] = CHECK_KINDS.flatMap((kind) => {
    const t = templates.find((x) => x.kind === kind)
    if (!t || !t.enabled) return []
    const day = active?.kind === kind ? active.day : today
    const cell = cellFor(kind, day)
    return [{
      kind,
      label: CHECK_LABEL[kind],
      windowLabel: `${minutesLabel(t.opensAtMin)} – ${minutesLabel(t.dueAtMin)}`,
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
    activeCheck = {
      kind: active.kind,
      day: active.day,
      label: CHECK_LABEL[active.kind],
      dueAt: b.due.getTime(),
      closesAt: b.closes.getTime(),
      dueLabel: minutesLabel(t.dueAtMin),
      sections: await loadSections(store.id, active.kind),
    }
  }

  const upcoming = rows.find((r) => r.status === "upcoming")
  const upcomingTpl = upcoming ? templates.find((t) => t.kind === upcoming.kind) : undefined

  return {
    store: { name: store.name },
    day: today,
    rows,
    active: activeCheck,
    next: upcoming && upcomingTpl
      ? { label: upcoming.label, opensLabel: minutesLabel(upcomingTpl.opensAtMin) }
      : null,
    closedToday: grid?.closedDays.includes(today) ?? false,
    serverNow: now.getTime(),
  }
}

export async function loadSections(storeId: string, kind: CheckKindName): Promise<CrewSection[]> {
  const tpl = await prisma.checkTemplate.findUnique({
    where: { storeId_kind: { storeId, kind } },
    select: {
      sections: {
        orderBy: { position: "asc" },
        select: {
          id: true, nameEn: true, nameEs: true, photoRequired: true, photoHintEn: true, photoHintEs: true,
          items: { orderBy: { position: "asc" }, select: { id: true, textEn: true, textEs: true } },
        },
      },
    },
  })
  return (tpl?.sections ?? [])
    .filter((s) => s.items.length > 0 || s.photoRequired)
    .map((s) => ({
      id: s.id,
      en: s.nameEn,
      es: s.nameEs,
      photoRequired: s.photoRequired,
      hintEn: s.photoHintEn,
      hintEs: s.photoHintEs,
      items: s.items.map((i) => ({ id: i.id, en: i.textEn, es: i.textEs })),
    }))
}

/** The public link printed on a store's poster. */
export function checkLink(code: string): string {
  const base =
    process.env.CHECKS_BASE_URL ??
    `${(process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")}/checks`
  return `${base.replace(/\/$/, "")}/${code}`
}
