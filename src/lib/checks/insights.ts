import { currentMarks, type GridCell, type GridMark, type GridStore } from "./data"
import { countsToward } from "./status"
import { CHECK_LABEL, clockLabel, durationLabel, weekdayOf, windowBounds, type CheckKindName, type CheckWindow } from "./time"

/**
 * What the saved ticks say about store checks, beyond on time or missed:
 * the share of tasks done, ticks made in a rush, when ticks happened against
 * the window, which tasks get missed most, which nights slip, and what each
 * person did. Pure: everything here is counted from `loadCheckGrid`'s cells,
 * so the Today page, the check detail and the Report can never disagree.
 *
 * Nothing is estimated. A check closed before checks closed themselves has
 * no task list, so it adds to "checks" counts but never to a task count.
 */

/** Ticks this close together by one person read as ticked at the end, not as the work was done. */
export const BURST_WINDOW_MS = 3 * 60_000
/** ...when there are at least this many of them. */
export const BURST_MIN = 6

export type Burst = { count: number; from: Date; to: Date; by: string }

/**
 * The biggest run of tasks one person ticked within three minutes, among the
 * ticks that stand (a task later unticked does not count). Null under
 * `BURST_MIN`.
 */
export function tickBurst(marks: GridMark[]): Burst | null {
  const standing = [...currentMarks(marks).values()].filter((m) => m.done).sort((a, b) => a.at.getTime() - b.at.getTime())
  let best: Burst | null = null
  const byPerson = new Map<string, GridMark[]>()
  for (const m of standing) byPerson.set(m.crewName, [...(byPerson.get(m.crewName) ?? []), m])
  for (const [by, list] of byPerson) {
    let lo = 0
    for (let hi = 0; hi < list.length; hi++) {
      while (list[hi].at.getTime() - list[lo].at.getTime() > BURST_WINDOW_MS) lo += 1
      const count = hi - lo + 1
      if (count >= BURST_MIN && (!best || count > best.count)) best = { count, from: list[lo].at, to: list[hi].at, by }
    }
  }
  return best
}

export type Timeline = {
  /** "10:31 pm", the left edge: the first tick or when Submit opens, whichever is earlier. */
  startLabel: string
  endLabel: string
  dueLabel: string
  /** 0..100 along the strip. */
  duePct: number
  ticks: Array<{ pct: number; late: boolean }>
}

/** Where each standing tick fell between the start of work and the window's end. Null with no ticks. */
export function tickTimeline(day: string, w: CheckWindow, marks: GridMark[]): Timeline | null {
  const standing = [...currentMarks(marks).values()].filter((m) => m.done)
  if (standing.length === 0) return null
  const b = windowBounds(day, w)
  const first = Math.min(...standing.map((m) => m.at.getTime()))
  const start = Math.min(first, b.submitFrom.getTime())
  const end = Math.max(b.closes.getTime(), ...standing.map((m) => m.at.getTime()))
  const span = Math.max(1, end - start)
  const pct = (t: number) => Math.round(((t - start) / span) * 1000) / 10
  return {
    startLabel: clockLabel(new Date(start)),
    endLabel: clockLabel(new Date(end)),
    dueLabel: clockLabel(b.due),
    duePct: pct(b.due.getTime()),
    ticks: standing
      .sort((a, c) => a.at.getTime() - c.at.getTime())
      .map((m) => ({ pct: pct(m.at.getTime()), late: m.at.getTime() > b.due.getTime() })),
  }
}

/** Done and total tasks over the cells that count (sent, closed or missed); null when none had a list. */
export function taskShare(cells: GridCell[]): { done: number; total: number; pct: number } | null {
  let done = 0
  let total = 0
  for (const c of cells) {
    if (countsToward(c.status) === null) continue
    done += c.done
    total += c.total
  }
  return total === 0 ? null : { done, total, pct: Math.round((done / total) * 100) }
}

// ─── Report ────────────────────────────────────────────────────────────────

export type ReportMissedTask = { store: string; check: string; item: string; missed: number; of: number }
export type ReportWeekday = { kind: CheckKindName; label: string; days: Array<{ weekday: number; short: string; pct: number | null; checks: number }> }
export type ReportPerson = {
  name: string
  checks: number
  tasks: number
  lateTicks: number
  notes: number
  /** Their first to last tick on a check, the middle value. Null for a single tick each time. */
  typicalSpan: string | null
}

export type CheckReportFigures = {
  share: { done: number; total: number; pct: number } | null
  checks: { due: number; complete: number; partial: number; missed: number; late: number }
  rushed: number
  mostMissed: ReportMissedTask[]
  weekdays: ReportWeekday[]
  people: ReportPerson[]
  photosSentBack: number
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export function checkReport(grid: GridStore[], days: string[]): CheckReportFigures {
  const inRange = (c: GridCell) => days.includes(c.day)
  const cells = grid.flatMap((s) => s.cells.filter(inRange).map((c) => ({ store: s, cell: c })))
  const counted = cells.filter(({ cell }) => countsToward(cell.status) !== null)

  const checks = { due: counted.length, complete: 0, partial: 0, missed: 0, late: 0 }
  for (const { cell } of counted) {
    if (cell.status === "on_time") checks.complete += 1
    else if (cell.status === "late") {
      checks.complete += 1
      checks.late += 1
    } else if (cell.status === "partial") checks.partial += 1
    else checks.missed += 1
  }

  // Most missed: per store and task, how often it was missed out of the checks it was on.
  const tally = new Map<string, ReportMissedTask>()
  for (const { store, cell } of counted) {
    for (const t of cell.submission?.tasks ?? []) {
      const key = `${store.id}:${cell.kind}:${t.item}`
      const cur = tally.get(key) ?? { store: store.name, check: CHECK_LABEL[cell.kind].en, item: t.item, missed: 0, of: 0 }
      cur.of += 1
      if (!t.done) cur.missed += 1
      tally.set(key, cur)
    }
  }
  const mostMissed = [...tally.values()]
    .filter((t) => t.missed > 0)
    .sort((a, b) => b.missed / b.of - a.missed / a.of || b.missed - a.missed || a.item.localeCompare(b.item))
    .slice(0, 8)

  // Weekdays: share of tasks done, by check, by the weekday the check belongs to.
  const kinds = [...new Set(counted.map(({ cell }) => cell.kind))]
  const weekdays: ReportWeekday[] = (["MORNING", "EVENING"] as const)
    .filter((k) => kinds.includes(k))
    .map((kind) => ({
      kind,
      label: CHECK_LABEL[kind].en,
      // Monday first, as a week of shifts reads.
      days: [1, 2, 3, 4, 5, 6, 0].map((wd) => {
        const these = counted.filter(({ cell }) => cell.kind === kind && weekdayOf(cell.day) === wd).map(({ cell }) => cell)
        return { weekday: wd, short: WD[wd], pct: taskShare(these)?.pct ?? null, checks: these.length }
      }),
    }))

  // People: credit for what they ticked, from the record when there is one.
  const people = new Map<string, { checks: Set<string>; tasks: number; lateTicks: number; notes: number; spans: number[] }>()
  let rushed = 0
  let photosSentBack = 0
  for (const { store, cell } of counted) {
    if (tickBurst(cell.marks)) rushed += 1
    photosSentBack += cell.marks.filter((m) => m.review === "redo").length
    const tpl = store.templates.find((t) => t.kind === cell.kind)
    const due = tpl ? windowBounds(cell.day, tpl).due.getTime() : Infinity
    const standing = cell.submission?.tasks.filter((t) => t.done && t.by) ??
      [...currentMarks(cell.marks).values()].filter((m) => m.done).map((m) => ({ by: m.crewName, at: m.at, note: m.note }))
    const mine = new Map<string, number[]>()
    for (const t of standing) {
      const by = t.by!
      const p = people.get(by) ?? { checks: new Set(), tasks: 0, lateTicks: 0, notes: 0, spans: [] }
      p.checks.add(`${store.id}:${cell.kind}:${cell.day}`)
      p.tasks += 1
      if (t.at && t.at.getTime() > due) p.lateTicks += 1
      if (t.note) p.notes += 1
      people.set(by, p)
      if (t.at) mine.set(by, [...(mine.get(by) ?? []), t.at.getTime()])
    }
    for (const [by, times] of mine) {
      if (times.length > 1) people.get(by)!.spans.push(Math.max(...times) - Math.min(...times))
    }
  }

  return {
    share: taskShare(counted.map(({ cell }) => cell)),
    checks,
    rushed,
    mostMissed,
    weekdays,
    people: [...people.entries()]
      .map(([name, p]) => ({
        name,
        checks: p.checks.size,
        tasks: p.tasks,
        lateTicks: p.lateTicks,
        notes: p.notes,
        typicalSpan: p.spans.length > 0 ? durationLabel(median(p.spans)) : null,
      }))
      .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name)),
    photosSentBack,
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
