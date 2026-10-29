import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"
import { loadCheckGrid, shortName, type GridCell, type GridStore } from "@/lib/checks/data"
import { recordCheckAlerts } from "@/lib/checks/missed-alerts"
import { checkLink } from "@/lib/checks/crew"
import { shortStoreName } from "@/lib/checks/names"
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
  minutesLabel,
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
  /** Tasks done out of the list, live for a check in progress. */
  done: number
  total: number
  /** Everyone who ticked a task or submitted. */
  people: string[]
  /** Open now: crew can still tick and submit it. */
  live: boolean
  /** The Today tile, worked out here so the page never reads `status`. */
  tile: { tone: "ok" | "miss" | "open" | null; headline: string; sub: string | null; meta: string | null; bar: boolean }
  /** Every tick, untick and note, oldest first, then the submit. */
  log: Array<{
    id: string
    at: string
    by: string
    text: string
    /** "done", "undone", "note" or "submitted". */
    action: "done" | "undone" | "note" | "submitted"
    note: string | null
    /** The mark's photo, served by /api/checks/mark-photo/<id>. */
    photo: boolean
  }>
}

function cellView(store: GridStore, cell: GridCell, now: Date): CellView {
  const tpl = store.templates.find((t) => t.kind === cell.kind)!
  const b = windowBounds(cell.day, tpl)
  const sub = cell.submission
  let label: string
  let meta: string | null = null
  let progress: number | null = null
  const log: CellView["log"] = cell.marks.map((m) => ({
    id: m.id,
    at: clockLabel(m.at),
    by: m.crewName,
    text: m.itemText,
    action: !m.done ? "undone" : m.note ? "note" : "done",
    note: m.note,
    photo: m.hasPhoto,
  }))
  if (sub) {
    log.push({ id: sub.id, at: clockLabel(sub.submittedAt), by: sub.crewName, text: "Submitted", action: "submitted", note: null, photo: false })
  }
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
      label = store.preOpen ? "Not open yet" : "Store closed"
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
      const t = now.getTime()
      progress = cell.total > 0 ? cell.done / cell.total : 0
      if (t < b.submitFrom.getTime()) {
        label = `${cell.done} of ${cell.total} done`
        meta = `Submit opens ${clockLabel(b.submitFrom)}`
      } else if (t <= b.due.getTime()) {
        label = `${cell.done} of ${cell.total} · not sent`
        meta = `Closes ${clockLabel(b.due)} · ${durationLabel(b.due.getTime() - t)} left`
      } else {
        label = "Overdue"
        meta = `Late now · takes it until ${clockLabel(b.closes)}`
      }
      break
    }
  }
  if (sub) meta = `${clockLabel(sub.submittedAt)} · ${sub.crewName}`
  const sent = cell.status === "on_time" || cell.status === "late"
  const live = cell.status === "open"
  const tile: CellView["tile"] = {
    tone: sent ? "ok" : cell.status === "missed" ? "miss" : live ? "open" : null,
    headline: sent && sub ? `Sent ${clockLabel(sub.submittedAt)}` : label,
    sub: sent
      ? cell.people.join(", ") || sub?.crewName || null
      : live
        ? cell.people.length > 0
          ? `On it: ${cell.people.join(", ")}`
          : "Nobody has started"
        : null,
    meta: sent ? null : meta,
    bar: live && progress !== null,
  }
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
    done: cell.done,
    total: cell.total,
    people: cell.people,
    live,
    tile,
    log,
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
    preOpen: boolean
    rate7: number | null
    closedToday: boolean
    cells: Array<CellView | null>
    /** The last seven days, oldest first, one cell per check. */
    week: Array<{ day: string; top: string; cells: Array<CellView | null> }>
  }>
  /** Missed checks yesterday and today, folded into one summary. */
  missed: {
    count: number
    /** "Hollywood: Wed morning, Wed night. Van Nuys: Wed night." */
    line: string
    days: Array<{ day: string; label: string }>
    stores: Array<{ id: string; name: string; cells: Array<{ day: string; kind: CheckKindName; status: CellStatus; label: string }> }>
  } | null
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
        const recent = [yesterday, today]
        const short = (day: string, kind: CheckKindName) =>
          `${new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })} ${CHECK_LABEL[kind].en.toLowerCase()}`
        const missedParts: string[] = []
        let missedCount = 0
        for (const s of grid) {
          const m = s.cells.filter((c) => c.status === "missed" && recent.includes(c.day))
          if (m.length === 0) continue
          missedCount += m.length
          missedParts.push(`${shortStoreName(s.name)}: ${m.map((c) => short(c.day, c.kind)).join(", ")}.`)
        }
        const missed: TodayData["missed"] = missedCount === 0
          ? null
          : {
              count: missedCount,
              line: missedParts.join(" "),
              days: recent.map((d) => ({ day: d, label: d === today ? "Today" : "Yesterday" })),
              stores: grid.filter((s) => !s.preOpen).map((s) => ({
                id: s.id,
                name: s.name,
                cells: recent.flatMap((day) =>
                  CHECK_KINDS.flatMap((kind) => {
                    const c = s.cells.find((x) => x.day === day && x.kind === kind)
                    return c ? [{ day, kind, status: c.status, label: short(day, kind) }] : []
                  }),
                ),
              })),
            }
        const weekDays: string[] = []
        for (let d = addDays(today, -6); d <= today; d = addDays(d, 1)) weekDays.push(d)
        return {
          day: today,
          dayLabel: dayLabel(today),
          columns,
          missed,
          stores: grid.map((s) => ({
            id: s.id,
            name: s.name,
            preOpen: s.preOpen,
            closedToday: s.closedDays.includes(today),
            week: weekDays.map((day) => ({
              day,
              top: new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }),
              cells: CHECK_KINDS.map((kind) => {
                const c = s.cells.find((x) => x.day === day && x.kind === kind)
                return c ? cellView(s, c, now) : null
              }),
            })),
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

export type EditorItem = { id: string; en: string; es: string; photoRequired: boolean }
export type EditorSection = {
  id: string
  nameEn: string
  nameEs: string
  items: EditorItem[]
}
export type EditorTemplate = {
  kind: CheckKindName
  label: string
  /** Crew can see the list from here. */
  opensAtMin: number
  /** Submit unlocks here. */
  submitFromMin: number
  /** Submit locks here. */
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
              submitFromMin: t.submitFromMin ?? t.opensAtMin,
              dueAtMin: t.dueAtMin,
              dueByWeekday: t.dueByWeekday,
              graceMin: t.graceMin,
              enabled: t.enabled,
              sections: t.sections.map((s) => ({
                id: s.id,
                nameEn: s.nameEn,
                nameEs: s.nameEs ?? "",
                items: s.items.map((i) => ({ id: i.id, en: i.textEn, es: i.textEs ?? "", photoRequired: i.photoRequired })),
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
  /** Where every submitted check is emailed. */
  reportEmails: string[]
  emailReady: boolean
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
            checkTemplates: { select: { kind: true, opensAtMin: true, submitFromMin: true, dueAtMin: true, dueByWeekday: true, graceMin: true, enabled: true } },
          },
          orderBy: { name: "asc" },
        })
        const account = await prisma.account.findUnique({ where: { id: opts.accountId }, select: { checkReportEmails: true } })
        return {
          reportEmails: account?.checkReportEmails ?? [],
          emailReady: emailConfigured(),
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
                return [{ label: CHECK_LABEL[kind].en, window: `Opens ${minutesLabel(t.opensAtMin)} · submit ${windowSummary(t)}` }]
              }),
            }
          }),
        }
      }, { retryAction: "checks.posters", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.posters",
    ),
  }
}
