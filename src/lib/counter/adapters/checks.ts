import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"
import { loadCheckGrid, shortName, type GridCell, type GridStore } from "@/lib/checks/data"
import { recordCheckAlerts } from "@/lib/checks/missed-alerts"
import { checkLink } from "@/lib/checks/crew"
import { emailConfigured } from "@/lib/checks/email"
import { ensureCheckSetup } from "@/lib/checks/setup"
import { onTimeRate, type CellStatus } from "@/lib/checks/status"
import {
  addDays,
  CHECK_KINDS,
  CHECK_LABEL,
  clockLabel,
  dayLabel,
  durationLabel,
  windowSummary,
  todayLA,
  windowBounds,
  type CheckKindName,
} from "@/lib/checks/time"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Store checks — the five owner tabs (Today, History, Checklists, Crew & PINs,
 * QR posters). Every query is scoped by `accountId`, the tenancy boundary;
 * the per-cell status comes from `cellStatus` in `src/lib/checks/status.ts`
 * through `loadCheckGrid`, the one place that decides on time / late / missed.
 */

export type StoreOption = { id: string; name: string }

async function accountStores(accountId: string): Promise<StoreOption[]> {
  return prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

function pickStore(stores: StoreOption[], requested: string | undefined): StoreOption | null {
  return stores.find((s) => s.id === requested) ?? stores[0] ?? null
}

export type CellView = {
  kind: CheckKindName
  day: string
  status: CellStatus
  /** "On time", "Late, 12 min", "Missed", "Open", "Opens 9:00 pm", "Closed", "Off". */
  label: string
  /** "9:41 am · Maria G." or a progress line for an open check. */
  meta: string | null
  photos: Array<{ id: string; section: string }>
  flags: Array<{ section: string; item: string; note: string }>
  /** 0..1 of the window used, for an open check. */
  progress: number | null
  started: string | null
  submittedAt: string | null
  startedAt: string | null
  by: string | null
  dueLabel: string
}

function cellView(store: GridStore, cell: GridCell, now: Date): CellView {
  const tpl = store.templates.find((t) => t.kind === cell.kind)!
  const b = windowBounds(cell.day, tpl)
  const sub = cell.submission
  let label: string
  let meta: string | null = null
  let progress: number | null = null
  switch (cell.status) {
    case "on_time":
      label = "On time"
      break
    case "late":
      label = `Late, ${durationLabel((sub?.lateMinutes ?? 0) * 60_000)}`
      break
    case "missed":
      label = "Missed"
      meta = `Due ${clockLabel(b.due)} · nobody submitted`
      break
    case "closed":
      label = "Store closed"
      break
    case "off":
      label = "Switched off"
      break
    case "before":
      label = "Before checks began"
      break
    case "upcoming":
      label = `Opens ${clockLabel(b.opens)}`
      break
    case "open": {
      const overdue = now.getTime() > b.due.getTime()
      label = overdue ? "Overdue" : "Open"
      const span = b.due.getTime() - b.opens.getTime()
      progress = span > 0 ? Math.min(1, (now.getTime() - b.opens.getTime()) / span) : 1
      meta = overdue
        ? `Late now · takes it until ${clockLabel(b.closes)}`
        : `${durationLabel(b.due.getTime() - now.getTime())} left`
      break
    }
  }
  if (sub) meta = `${clockLabel(sub.submittedAt)} · ${sub.crewName}`
  return {
    kind: cell.kind,
    day: cell.day,
    status: cell.status,
    label,
    meta,
    photos: sub?.photos.map((p) => ({ id: p.id, section: p.sectionName })) ?? [],
    flags: sub?.flags ?? [],
    progress,
    started: !sub && cell.startedBy ? `${cell.startedBy.name} started ${clockLabel(cell.startedBy.at)}` : null,
    submittedAt: sub ? clockLabel(sub.submittedAt) : null,
    startedAt: sub?.startedAt ? clockLabel(sub.startedAt) : null,
    by: sub?.crewName ?? null,
    dueLabel: clockLabel(b.due),
  }
}

// ─── Today ──────────────────────────────────────────────────────────────────

export type TodayData = {
  day: string
  dayLabel: string
  columns: Array<{ kind: CheckKindName; label: string; window: string }>
  stores: Array<{
    id: string
    name: string
    rate7: number | null
    closedToday: boolean
    cells: Array<CellView | null>
  }>
  alerts: Array<{ storeId: string; text: string; detail: string; day: string; kind: CheckKindName }>
}

export type TodaySections = { today: SectionData<TodayData> }

export function getChecksTodaySectionPromises(opts: { accountId: string; now?: Date }): StreamedSections<TodaySections> {
  const now = opts.now ?? new Date()
  return {
    today: guardSection(
      classify(async () => {
        const today = todayLA(now)
        const grid = await loadCheckGrid({ accountId: opts.accountId, fromDay: addDays(today, -7), toDay: today, now })
        // Keep Needs you in step with what this page is about to show.
        await recordCheckAlerts({ accountId: opts.accountId, now, days: 2 }).catch(() => undefined)

        const columns = CHECK_KINDS.map((kind) => {
          const t = grid.flatMap((s) => s.templates).find((x) => x.kind === kind)
          return {
            kind,
            label: CHECK_LABEL[kind].en,
            window: t ? windowSummary(t) : "",
          }
        })
        const yesterday = addDays(today, -1)
        const alerts: TodayData["alerts"] = []
        for (const s of grid) {
          for (const c of s.cells) {
            if (c.status !== "missed" || (c.day !== today && c.day !== yesterday)) continue
            const v = cellView(s, c, now)
            alerts.push({
              storeId: s.id,
              kind: c.kind,
              day: c.day,
              text: `${s.name} · ${CHECK_LABEL[c.kind].en} check missed ${c.day === today ? "today" : "yesterday"}.`,
              detail: `Due ${dayLabel(c.day)} at ${v.dueLabel}. Nobody submitted it.`,
            })
          }
        }
        return {
          day: today,
          dayLabel: dayLabel(today),
          columns,
          alerts,
          stores: grid.map((s) => ({
            id: s.id,
            name: s.name,
            closedToday: s.closedDays.includes(today),
            rate7: onTimeRate(s.cells.filter((c) => c.day !== today || c.status !== "open").map((c) => c.status)),
            cells: CHECK_KINDS.map((kind) => {
              const c = s.cells.find((x) => x.day === today && x.kind === kind)
              return c ? cellView(s, c, now) : null
            }),
          })),
        }
      }, { retryAction: "checks.today", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.today",
    ),
  }
}

// ─── History ────────────────────────────────────────────────────────────────

export type HistoryData = {
  range: 7 | 14 | 30
  storeId: string | null
  stores: StoreOption[]
  days: Array<{ day: string; top: string; bottom: string; weekend: boolean }>
  rows: Array<{
    storeId: string
    store: string
    first: boolean
    kind: CheckKindName
    label: string
    rate: number | null
    cells: CellView[]
  }>
  topFlags: Array<{ store: string; item: string; count: number }>
}

export type HistorySections = { history: SectionData<HistoryData> }

export function getChecksHistorySectionPromises(opts: {
  accountId: string
  range?: number
  storeId?: string
  now?: Date
}): StreamedSections<HistorySections> {
  const now = opts.now ?? new Date()
  const range = (opts.range === 7 || opts.range === 30 ? opts.range : 14) as 7 | 14 | 30
  return {
    history: guardSection(
      classify(async () => {
        const stores = await accountStores(opts.accountId)
        const only = stores.find((s) => s.id === opts.storeId)
        const toDay = todayLA(now)
        const fromDay = addDays(toDay, -(range - 1))
        const grid = await loadCheckGrid({
          accountId: opts.accountId,
          storeIds: only ? [only.id] : undefined,
          fromDay,
          toDay,
          now,
        })
        const days: HistoryData["days"] = []
        for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
          const dt = new Date(`${d}T12:00:00.000Z`)
          const wd = dt.getUTCDay()
          days.push({
            day: d,
            top: dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "narrow" }),
            bottom: String(dt.getUTCDate()),
            weekend: wd === 0 || wd === 6,
          })
        }
        const rows: HistoryData["rows"] = []
        const flagCount = new Map<string, { store: string; item: string; count: number }>()
        for (const s of grid) {
          s.templates.forEach((t, i) => {
            const cells = days.map((d) => {
              const c = s.cells.find((x) => x.day === d.day && x.kind === t.kind)!
              for (const f of c.submission?.flags ?? []) {
                const k = `${s.id}:${f.item}`
                const cur = flagCount.get(k) ?? { store: s.name, item: f.item, count: 0 }
                cur.count += 1
                flagCount.set(k, cur)
              }
              return cellView(s, c, now)
            })
            rows.push({
              storeId: s.id,
              store: s.name,
              first: i === 0,
              kind: t.kind,
              label: CHECK_LABEL[t.kind].en,
              rate: onTimeRate(cells.map((c) => c.status)),
              cells,
            })
          })
        }
        const topFlags = [...flagCount.values()].sort((a, b) => b.count - a.count).slice(0, 6)
        return { range, storeId: only?.id ?? null, stores, days, rows, topFlags }
      }, { retryAction: "checks.history", isEmpty: (d) => d.rows.length === 0, emptyReason: "no_stores" }),
      "checks.history",
    ),
  }
}

// ─── Checklists ─────────────────────────────────────────────────────────────

export type EditorItem = { id: string; en: string; es: string }
export type EditorSection = {
  id: string
  nameEn: string
  nameEs: string
  photoRequired: boolean
  hintEn: string
  hintEs: string
  items: EditorItem[]
}
export type EditorTemplate = {
  kind: CheckKindName
  label: string
  opensAtMin: number
  dueAtMin: number
  /** Empty, or seven due times, Sunday first. */
  dueByWeekday: number[]
  graceMin: number
  enabled: boolean
  sections: EditorSection[]
}
export type ChecklistsData = { stores: StoreOption[]; store: StoreOption; templates: EditorTemplate[] }
export type ChecklistsSections = { checklists: SectionData<ChecklistsData> }

export function getChecksChecklistsSectionPromises(opts: {
  accountId: string
  storeId?: string
}): StreamedSections<ChecklistsSections> {
  return {
    checklists: guardSection(
      classify(async () => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        await ensureCheckSetup(store.id)
        const templates = await prisma.checkTemplate.findMany({
          where: { storeId: store.id, store: { accountId: opts.accountId } },
          include: {
            sections: {
              orderBy: { position: "asc" },
              include: { items: { orderBy: { position: "asc" } } },
            },
          },
        })
        return {
          stores,
          store,
          templates: CHECK_KINDS.flatMap((kind) => {
            const t = templates.find((x) => x.kind === kind)
            if (!t) return []
            return [{
              kind,
              label: CHECK_LABEL[kind].en,
              opensAtMin: t.opensAtMin,
              dueAtMin: t.dueAtMin,
              dueByWeekday: t.dueByWeekday,
              graceMin: t.graceMin,
              enabled: t.enabled,
              sections: t.sections.map((s) => ({
                id: s.id,
                nameEn: s.nameEn,
                nameEs: s.nameEs ?? "",
                photoRequired: s.photoRequired,
                hintEn: s.photoHintEn ?? "",
                hintEs: s.photoHintEs ?? "",
                items: s.items.map((i) => ({ id: i.id, en: i.textEn, es: i.textEs ?? "" })),
              })),
            }]
          }),
        }
      }, { retryAction: "checks.checklists", isEmpty: (d) => d === null, emptyReason: "no_stores" }) as Promise<
        SectionData<ChecklistsData>
      >,
      "checks.checklists",
    ),
  }
}

// ─── Crew & PINs ────────────────────────────────────────────────────────────

export type CrewRow = {
  id: string
  name: string
  firstName: string
  lastName: string
  email: string
  pin: string | null
  source: "HARRI" | "MANUAL"
  active: boolean
  inactiveReason: string | null
  lastCheck: string | null
  pinEmailedAt: string | null
}
export type CrewData = {
  stores: StoreOption[]
  store: StoreOption
  crew: CrewRow[]
  harriSyncedAt: string | null
  harriLinked: boolean
  emailReady: boolean
}
export type CrewSections = { crew: SectionData<CrewData> }

export function getChecksCrewSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<CrewSections> {
  return {
    crew: guardSection(
      classify(async () => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        const [crew, synced, brand] = await Promise.all([
          prisma.crewMember.findMany({
            where: { storeId: store.id, store: { accountId: opts.accountId } },
            orderBy: [{ active: "desc" }, { firstName: "asc" }],
            include: {
              submissions: { orderBy: { submittedAt: "desc" }, take: 1, select: { submittedAt: true, kind: true } },
            },
          }),
          prisma.harriEmployee.findFirst({
            where: { storeId: store.id, store: { accountId: opts.accountId } },
            orderBy: { syncedAt: "desc" },
            select: { syncedAt: true },
          }),
          prisma.harriBrand.findFirst({ where: { storeId: store.id }, select: { id: true } }),
        ])
        return {
          stores,
          store,
          harriSyncedAt: synced ? synced.syncedAt.toISOString() : null,
          harriLinked: Boolean(brand),
          emailReady: emailConfigured(),
          crew: crew.map((c) => {
            const last = c.submissions[0]
            return {
              id: c.id,
              name: shortName(c.firstName, c.lastName),
              firstName: c.firstName,
              lastName: c.lastName ?? "",
              email: c.email ?? "",
              pin: c.pin,
              source: c.source,
              active: c.active,
              inactiveReason: c.inactiveReason,
              lastCheck: last
                ? `${dayLabel(last.submittedAt.toISOString().slice(0, 10))} ${clockLabel(last.submittedAt)} · ${CHECK_LABEL[last.kind as CheckKindName].en}`
                : null,
              pinEmailedAt: c.pinEmailedAt ? c.pinEmailedAt.toISOString() : null,
            }
          }),
        }
      }, { retryAction: "checks.crew", isEmpty: (d) => d === null, emptyReason: "no_stores" }) as Promise<
        SectionData<CrewData>
      >,
      "checks.crew",
    ),
  }
}

// ─── QR posters ─────────────────────────────────────────────────────────────

export type PosterData = {
  stores: Array<{
    id: string
    name: string
    link: string
    /** QR modules, row-major, true = dark. */
    qr: { size: number; cells: string }
    windows: Array<{ label: string; window: string }>
  }>
}
export type PostersSections = { posters: SectionData<PosterData> }

export function getChecksPostersSectionPromises(opts: { accountId: string }): StreamedSections<PostersSections> {
  return {
    posters: guardSection(
      classify(async () => {
        const stores = await accountStores(opts.accountId)
        await Promise.all(stores.map((s) => ensureCheckSetup(s.id)))
        const rows = await prisma.store.findMany({
          where: { accountId: opts.accountId, isActive: true },
          select: {
            id: true, name: true, checkCode: true,
            checkTemplates: { select: { kind: true, opensAtMin: true, dueAtMin: true, dueByWeekday: true, graceMin: true, enabled: true } },
          },
          orderBy: { name: "asc" },
        })
        return {
          stores: rows.filter((r) => r.checkCode).map((r) => {
            const link = checkLink(r.checkCode!)
            // Error correction H: the logo covers the middle and the code still reads.
            const qr = QRCode.create(link, { errorCorrectionLevel: "H" })
            const size = qr.modules.size
            let cells = ""
            for (let i = 0; i < size * size; i++) cells += qr.modules.data[i] ? "1" : "0"
            return {
              id: r.id,
              name: r.name,
              link,
              qr: { size, cells },
              windows: CHECK_KINDS.flatMap((kind) => {
                const t = r.checkTemplates.find((x) => x.kind === kind)
                if (!t || !t.enabled) return []
                return [{ label: CHECK_LABEL[kind].en, window: windowSummary(t) }]
              }),
            }
          }),
        }
      }, { retryAction: "checks.posters", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.posters",
    ),
  }
}
