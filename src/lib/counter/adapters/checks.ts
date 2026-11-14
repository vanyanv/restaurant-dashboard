import QRCode from "qrcode"
import { prisma } from "@/lib/prisma"
import { loadCheckGrid, shortName, type GridCell, type GridStore } from "@/lib/checks/data"
import { recordCheckAlerts } from "@/lib/checks/missed-alerts"
import { checkLink } from "@/lib/checks/crew"
import { shortStoreName } from "@/lib/checks/names"
import { emailConfigured } from "@/lib/checks/email"
import { ensureCheckSetup } from "@/lib/checks/setup"
import { countsToward, onTimeRate, type CellStatus } from "@/lib/checks/status"
import { checkReport, taskShare, tickBurst, tickTimeline, type CheckReportFigures, type Timeline } from "@/lib/checks/insights"
import {
  addDays,
  CHECK_KINDS,
  CHECK_LABEL,
  clockLabel,
  dayLabel,
  durationLabel,
  minutesLabel,
  windowOverrides,
  windowRange,
  windowSummary,
  tileDay,
  todayLA,
  weekdayOf,
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
  /** The check closed itself when its window ended; nobody pressed Submit. */
  autoClosed: boolean
  /** Tasks nobody ticked before it closed, in list order. */
  missed: Array<{ section: string; item: string }>
  /** Went wrong: missed, some tasks missed, or late. Worked out here so pages never read `status`. */
  problem: boolean
  /** Counts toward the record (sent, closed or missed), so it is in a day's total. */
  counted: boolean
  /** "9 tasks ticked 1:10–1:13 am by Jose M." when one person ticked many at once. */
  burst: string | null
  /** When the ticks happened, against the due time. */
  timeline: Timeline | null
  /** The record, task by task, by section. Empty while a check is still open. */
  tasks: Array<{ section: string; items: Array<{ item: string; done: boolean; by: string | null; at: string | null; late: boolean; note: string | null; photo: boolean }> }>
  /** Each task's standing photo, with the owner's look at it. */
  markPhotos: Array<{ id: string; task: string; by: string; at: string; review: "ok" | "redo" | null; reviewNote: string | null }>
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
    /** "done", "undone", "note", "submitted" (crew pressed Submit) or "closed" (it closed itself). */
    action: "done" | "undone" | "note" | "submitted" | "closed"
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
    log.push(
      sub.autoClosed
        ? { id: sub.id, at: clockLabel(sub.submittedAt), by: "", text: closedLine(sub), action: "closed", note: null, photo: false }
        : { id: sub.id, at: clockLabel(sub.submittedAt), by: sub.crewName, text: "Submitted", action: "submitted", note: null, photo: false },
    )
  }
  switch (cell.status) {
    case "on_time":
      label = "On time"
      break
    case "late":
      label = `Late, ${durationLabel((sub?.lateMinutes ?? 0) * 60_000)}`
      break
    case "partial":
      label = `${cell.done} of ${cell.total} done`
      break
    case "missed":
      label = "Missed"
      meta = sub?.autoClosed ? "Nothing was ticked" : `Due ${clockLabel(b.due)} · nobody submitted`
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
    case "paused":
      label = "Paused for training"
      meta = cell.done > 0 ? `Practice: ${cell.done} of ${cell.total} ticked` : null
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
  if (sub) {
    meta = sub.autoClosed
      ? `Closed itself ${clockLabel(sub.submittedAt)}${sub.missed.length > 0 ? ` · ${sub.missed.length} missed` : ""}`
      : `${clockLabel(sub.submittedAt)} · ${sub.crewName}`
  }
  const sent = cell.status === "on_time" || cell.status === "late"
  const short = cell.status === "partial" || (cell.status === "missed" && Boolean(sub))
  const live = cell.status === "open"
  const tile: CellView["tile"] = {
    tone: sent ? "ok" : cell.status === "missed" || cell.status === "partial" ? "miss" : live ? "open" : null,
    headline: sent && sub
      ? sub.autoClosed ? `All ${cell.total} done` : `Sent ${clockLabel(sub.submittedAt)}`
      : cell.status === "partial"
        ? `${sub?.missed.length ?? 0} missed`
        : cell.status === "paused" ? "Paused" : label,
    sub: short
      ? missedPreview(sub?.missed ?? [])
      : sent
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
    by: sub && !sub.autoClosed ? sub.crewName : null,
    dueLabel: clockLabel(b.due),
    done: cell.done,
    total: cell.total,
    people: cell.people,
    autoClosed: Boolean(sub?.autoClosed),
    missed: sub?.missed ?? [],
    problem: cell.status === "missed" || cell.status === "partial" || cell.status === "late",
    counted: countsToward(cell.status) !== null,
    burst: burstLine(cell),
    timeline: tickTimeline(cell.day, tpl, cell.marks),
    tasks: recordBySection(cell, b.due.getTime()),
    markPhotos: [...currentMarksOf(cell)]
      .filter((m) => m.done && m.hasPhoto)
      .map((m) => ({ id: m.id, task: m.itemText, by: m.crewName, at: clockLabel(m.at), review: m.review, reviewNote: m.reviewNote })),
    live,
    tile,
    log,
  }
}

/** The latest mark per task, plus any photo the owner sent back since (so a redo stays visible). */
function currentMarksOf(cell: GridCell) {
  const latest = new Map<string, GridCell["marks"][number]>()
  for (const m of cell.marks) latest.set(m.itemId, m)
  const sentBack = cell.marks.filter((m) => m.review === "redo" && latest.get(m.itemId) !== m)
  return [...latest.values(), ...sentBack.map((m) => ({ ...m, done: true }))]
}

function burstLine(cell: GridCell): string | null {
  const b = tickBurst(cell.marks)
  if (!b) return null
  const from = clockLabel(b.from)
  const to = clockLabel(b.to)
  return `${b.count} tasks ticked ${from === to ? `at ${from}` : `${from}–${to}`} by ${b.by}`
}

function recordBySection(cell: GridCell, due: number): CellView["tasks"] {
  const out: CellView["tasks"] = []
  for (const t of cell.submission?.tasks ?? []) {
    let sec = out.find((s) => s.section === t.section)
    if (!sec) {
      sec = { section: t.section, items: [] }
      out.push(sec)
    }
    sec.items.push({
      item: t.item,
      done: t.done,
      by: t.by,
      at: t.at ? clockLabel(t.at) : null,
      late: Boolean(t.done && t.at && t.at.getTime() > due),
      note: t.note,
      photo: t.photo,
    })
  }
  // Missed first in each section, as the owner reads it.
  for (const s of out) s.items.sort((a, b) => Number(a.done) - Number(b.done))
  return out
}

/** "Closed itself · 18 of 21 done" for the log's last line. */
function closedLine(sub: NonNullable<GridCell["submission"]>): string {
  if (sub.done === 0) return "Closed itself · nothing ticked"
  if (sub.missed.length === 0) return `Closed itself · all ${sub.total} done`
  return `Closed itself · ${sub.done} of ${sub.total} done`
}

/** "Mop floors, Wipe soda machine +1 more" */
function missedPreview(missed: Array<{ item: string }>): string | null {
  if (missed.length === 0) return null
  const shown = missed.slice(0, 2).map((m) => m.item).join(", ")
  return missed.length > 2 ? `${shown} +${missed.length - 2} more` : shown
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
    /** "Paused since Tue 2:15 pm" while the owner trains crew, else null. */
    paused: string | null
    rate7: number | null
    closedToday: boolean
    cells: Array<CellView | null>
    /** The last seven days, oldest first, one cell per check. */
    week: Array<{ day: string; top: string; cells: Array<CellView | null> }>
  }>
  /** The page made plain: one sentence, then yesterday's share of tasks done against the same night a week before. */
  plain: {
    sentence: string
    share: { done: number; total: number; pct: number } | null
    /** "of tasks done yesterday" */
    shareLabel: string
    /** Points against the same weekday a week earlier; null when either had nothing due. */
    delta: number | null
    deltaLabel: string
  }
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
        // Eight days back: yesterday is compared with the same night a week before.
        const grid = await loadCheckGrid({ accountId: opts.accountId, fromDay: addDays(today, -8), toDay: today, now })
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
          const m = s.cells.filter((c) => (c.status === "missed" || c.status === "partial") && recent.includes(c.day))
          if (m.length === 0) continue
          missedCount += m.length
          missedParts.push(
            `${shortStoreName(s.name)}: ${m
              .map((c) => (c.status === "partial" ? `${short(c.day, c.kind)} (${c.submission?.missed.length ?? 0} tasks missed)` : short(c.day, c.kind)))
              .join(", ")}.`,
          )
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
          plain: todayPlain(grid, today, now),
          missed,
          stores: grid.map((s) => ({
            id: s.id,
            name: s.name,
            preOpen: s.preOpen,
            paused: s.pausedSince
              ? `Paused since ${dayLabel(todayLA(s.pausedSince))} ${clockLabel(s.pausedSince)}`
              : null,
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
            // Each tile shows the check that is going now: last night's
            // Night stays on its tile until its window closes after midnight.
            cells: CHECK_KINDS.map((kind) => {
              const tpl = s.templates.find((t) => t.kind === kind)
              const day = tpl ? tileDay(tpl, now) : today
              const c = s.cells.find((x) => x.day === day && x.kind === kind)
              return c ? cellView(s, c, now) : null
            }),
          })),
        }
      }, { retryAction: "checks.today", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.today",
    ),
  }
}

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

/** Names in a sentence: "A", "A and B", "A, B and C". */
function andList(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`
}

/**
 * Today's sentence and headline, from the same cells the cards show. A check
 * in progress leads; otherwise yesterday; paused stores are said last.
 */
function todayPlain(grid: GridStore[], today: string, now: Date): TodayData["plain"] {
  const yesterday = addDays(today, -1)
  const weekBefore = addDays(today, -8)
  const counting = grid.filter((s) => !s.preOpen && !s.pausedSince)
  const cellsOn = (day: string) => counting.flatMap((s) => s.cells.filter((c) => c.day === day))
  const share = taskShare(cellsOn(yesterday))
  const before = taskShare(cellsOn(weekBefore))
  const parts: string[] = []

  const live = counting.flatMap((s) =>
    s.cells
      // In progress: someone has ticked, or Submit is open. A list that is merely visible is not news.
      .filter((c) => c.status === "open" && (c.done > 0 || windowBounds(c.day, s.templates.find((t) => t.kind === c.kind)!).submitFrom.getTime() <= now.getTime()))
      .map((c) => ({ s, c })),
  )
  for (const { s, c } of live.slice(0, 2)) {
    const t = s.templates.find((x) => x.kind === c.kind)!
    const left = windowBounds(c.day, t).closes.getTime() - now.getTime()
    parts.push(
      `${shortStoreName(s.name)} is ${c.done} of ${c.total} on ${c.kind === "EVENING" ? "tonight's" : "today's"} ${CHECK_LABEL[c.kind].en} check, with ${durationLabel(left)} to go.`,
    )
  }
  if (parts.length === 0) {
    const y = counting.map((s) => ({ s, cells: s.cells.filter((c) => c.day === yesterday && countsToward(c.status) !== null) }))
    const bad = y
      .map(({ s, cells }) => ({ s, missed: cells.reduce((n, c) => n + (c.total - c.done), 0), notStarted: cells.filter((c) => c.done === 0).length }))
      .filter((x) => x.missed > 0)
    const good = y.filter(({ cells }) => cells.length > 0 && cells.every((c) => c.done === c.total)).map(({ s }) => shortStoreName(s.name))
    if (bad.length > 0) {
      parts.push(
        `Yesterday ${andList(bad.map((b) => `${shortStoreName(b.s.name)} missed ${b.missed} task${b.missed === 1 ? "" : "s"}`))}.`,
      )
      if (good.length > 0) parts.push(`${andList(good)} finished everything.`)
    } else if (good.length > 0) parts.push(`Yesterday ${andList(good)} finished every task.`)
    else parts.push("Nothing was due yesterday.")
  }
  const paused = grid.filter((s) => s.pausedSince).map((s) => shortStoreName(s.name))
  if (paused.length > 0) parts.push(`${andList(paused)} ${paused.length === 1 ? "is" : "are"} paused for training.`)

  return {
    sentence: parts.join(" "),
    share,
    shareLabel: "of tasks done yesterday",
    delta: share && before ? share.pct - before.pct : null,
    deltaLabel: `vs last ${WEEKDAY_LONG[weekdayOf(yesterday)]}`,
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
  /** "11 of 14 checks fully done in the last 7 days." */
  sentence: string
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
        for (const s of grid) {
          s.templates.forEach((t, i) => {
            const cells = days.map((d) => cellView(s, s.cells.find((x) => x.day === d.day && x.kind === t.kind)!, now))
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
        const topFlags = topFlagsOf(grid, days.map((d) => d.day))
        return { range, storeId: only?.id ?? null, stores, days, rows, topFlags, sentence: historySentence(grid, range) }
      }, { retryAction: "checks.history", isEmpty: (d) => d.rows.length === 0, emptyReason: "no_stores" }),
      "checks.history",
    ),
  }
}

/** The items crew flagged most on the given days, per store; History's phone page and the Report show it. */
function topFlagsOf(grid: GridStore[], days: string[]): Array<{ store: string; item: string; count: number }> {
  const inRange = new Set(days)
  const count = new Map<string, { store: string; item: string; count: number }>()
  for (const s of grid) {
    const kinds = new Set(s.templates.map((t) => t.kind))
    for (const c of s.cells) {
      if (!inRange.has(c.day) || !kinds.has(c.kind)) continue
      for (const f of c.submission?.flags ?? []) {
        const k = `${s.id}:${f.item}`
        const cur = count.get(k) ?? { store: s.name, item: f.item, count: 0 }
        cur.count += 1
        count.set(k, cur)
      }
    }
  }
  return [...count.values()].sort((a, b) => b.count - a.count).slice(0, 6)
}

function historySentence(grid: GridStore[], range: number): string {
  const cells = grid.flatMap((s) => s.cells).filter((c) => countsToward(c.status) !== null)
  if (cells.length === 0) return `Nothing was due in the last ${range} days.`
  const full = cells.filter((c) => c.status === "on_time" || c.status === "late").length
  const bad = cells.filter((c) => c.status === "missed" || c.status === "partial")
  const head = `${full} of ${cells.length} checks fully done in the last ${range} days.`
  if (bad.length === 0) return `${head} Nothing was missed.`
  const kinds = [...new Set(bad.map((c) => c.kind))]
  return kinds.length === 1 ? `${head} Every miss was on a ${CHECK_LABEL[kinds[0]].en} check.` : head
}

// ─── Report ─────────────────────────────────────────────────────────────────

export type ReportData = {
  range: 7 | 14 | 30
  storeId: string | null
  stores: StoreOption[]
  sentence: string
  figures: CheckReportFigures
  /** The share of tasks done in the range before, for the change. */
  prevPct: number | null
  /** The items crew flagged most in the range. */
  topFlags: Array<{ store: string; item: string; count: number }>
}

export type ReportSections = { report: SectionData<ReportData> }

export function getChecksReportSectionPromises(opts: {
  accountId: string
  range?: number
  storeId?: string
  now?: Date
}): StreamedSections<ReportSections> {
  const now = opts.now ?? new Date()
  const range = (opts.range === 7 || opts.range === 30 ? opts.range : 14) as 7 | 14 | 30
  return {
    report: guardSection(
      classify(async () => {
        const stores = await accountStores(opts.accountId)
        const only = stores.find((s) => s.id === opts.storeId)
        const toDay = todayLA(now)
        const fromDay = addDays(toDay, -(range - 1))
        // Twice the range: the second half is the comparison.
        const grid = await loadCheckGrid({
          accountId: opts.accountId,
          storeIds: only ? [only.id] : undefined,
          fromDay: addDays(fromDay, -range),
          toDay,
          now,
        })
        const span = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
        const days = span(fromDay, range)
        const figures = checkReport(grid, days)
        const prev = checkReport(grid, span(addDays(fromDay, -range), range)).share
        return {
          range,
          storeId: only?.id ?? null,
          stores,
          sentence: reportSentence(figures, range),
          figures,
          prevPct: prev?.pct ?? null,
          topFlags: topFlagsOf(grid, days),
        }
      }, { retryAction: "checks.report", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.report",
    ),
  }
}

function reportSentence(f: CheckReportFigures, range: number): string {
  if (!f.share) return `No check with a task list was due in the last ${range} days.`
  const top = f.mostMissed[0]
  const head = `${f.share.pct}% of tasks done in the last ${range} days.`
  if (!top) return `${head} No task was missed.`
  // The weekday that slips most for the top task's check.
  const wk = f.weekdays.find((w) => w.label === top.check)
  const worst = wk?.days.filter((d) => d.pct !== null).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0]
  return `${head} "${top.item}" is missed most (${top.missed} of ${top.of} ${top.check} checks)${
    worst && (worst.pct ?? 100) < 100 ? `, and ${top.check} slips most on ${worst.short}` : ""
  }.`
}

// ─── Checklists ─────────────────────────────────────────────────────────────

export type EditorItem = { id: string; en: string; es: string; photoRequired: boolean }
export type EditorSection = {
  id: string
  nameEn: string
  nameEs: string
  /** Off: hidden from crew, tasks kept. */
  enabled: boolean
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
                enabled: s.enabled,
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
    /** Enabled checks, for the poster: names and submit windows in English and Spanish. */
    windows: Array<{
      label: string
      labelEs: string
      opens: string
      /** The usual submit range, "12:30 am – 2:00 am". */
      submit: string
      /** Days that close later or earlier, "3:00 am Fri, Sat, Sun", and the same in Spanish. */
      until: string[]
      untilEs: string[]
    }>
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
                return [{
                  label: CHECK_LABEL[kind].en,
                  labelEs: CHECK_LABEL[kind].es,
                  opens: minutesLabel(t.opensAtMin),
                  submit: windowRange(t),
                  until: windowOverrides(t),
                  untilEs: windowOverrides(t, "es"),
                }]
              }),
            }
          }),
        }
      }, { retryAction: "checks.posters", isEmpty: (d) => d.stores.length === 0, emptyReason: "no_stores" }),
      "checks.posters",
    ),
  }
}
