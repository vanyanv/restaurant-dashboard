import { prisma } from "@/lib/prisma"
import { currentMarks, loadCheckGrid, type GridCell, type GridMark } from "./data"
import { ensureCheckSetup } from "./setup"
import { loadSections } from "./sections"
import { checkStateVersion } from "./version"
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
  /** The check closed itself when its window ended. `doneAt` is when. */
  autoClosed: boolean
  /** Tasks done and on the list, once it is in (sent or closed). */
  tasksDone: number
  tasksTotal: number
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
  /** The row this state comes from. An undo sends it back, so it can only undo what the phone showed. */
  markId: string
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
  /**
   * The owner has paused this store's checks to train crew: the list is open
   * whatever the time, Submit is always on, and submitting saves nothing.
   */
  practice: boolean
}

export type CrewView = {
  store: { name: string }
  day: string
  rows: CrewDayRow[]
  active: ActiveCheck | null
  /** `opensAt` is epoch ms: the crew page checks back right then instead of polling. */
  next: { label: { en: string; es: string }; opensLabel: string; opensAt: number } | null
  closedToday: boolean
  /** Checks are paused for training: the page is practice. See `ActiveCheck.practice`. */
  practice: boolean
  /** Epoch ms the open pause began; practice clean-up touches only rows after it. */
  practiceSince: number | null
  serverNow: number
  /**
   * The store's check-state fingerprint when this view was read (see
   * `version.ts`). The page's refresh sends it back, and gets the whole view
   * again only when it has changed.
   */
  version: string
}

export type CrewViewOptions = {
  /**
   * Run `ensureCheckSetup` first. On by default; off for a second load in
   * the same request, where the first already did it.
   */
  setup?: boolean
  /** The version, when the caller already computed it (the refresh does, to compare). */
  version?: string
  /**
   * Close a finished check before reading, as the owners' screens do. Only
   * the page render and a refresh whose version changed pass it: a window
   * ending changes the version (its phase is in it), so the first refresh
   * after a window ends closes it within seconds, as before, while the
   * unchanged refreshes in between write nothing.
   */
  autoClose?: boolean
}

/**
 * Read-only unless `autoClose` is passed. The phones refresh every few
 * seconds; an unchanged refresh never gets here (`version.ts` answers it),
 * and the taps (mark, submit, pin) never close anything.
 */
export async function loadCrewView(store: CrewStore, now: Date, opts: CrewViewOptions = {}): Promise<CrewView> {
  if (opts.setup !== false) await ensureCheckSetup(store.id)
  // Before the view's own reads, so a change made while they run is never
  // hidden behind this version: at worst the next refresh loads once more.
  const version = opts.version ?? (await checkStateVersion(store, now))
  const today = todayLA(now)
  const [grid] = await loadCheckGrid({
    accountId: store.accountId,
    storeIds: [store.id],
    fromDay: addDays(today, -1),
    toDay: today,
    now,
    setup: false,
    autoClose: opts.autoClose === true,
  })
  const templates = grid?.templates ?? []
  const cellFor = (kind: CheckKindName, day: string): GridCell | undefined =>
    grid?.cells.find((c) => c.kind === kind && c.day === day)

  // The check crew can work on now: a night still open past midnight belongs
  // to yesterday, so the day comes from the window.
  let active: { kind: CheckKindName; day: string; cell: GridCell } | null = null
  const practice = grid?.pausedSince != null
  if (practice) {
    // Practice: any time of day. The check whose list is up now comes first,
    // then today's others, skipping one sent for real before the pause began.
    // A window that had already closed when the pause began (so it stays
    // missed) can still be practised: training mid-afternoon must work.
    const visible = templates.filter((t) => t.enabled && visibleDay(t, now))
    const rest = templates.filter((t) => t.enabled && !visibleDay(t, now))
    for (const t of [...visible, ...rest]) {
      const day = visibleDay(t, now) ?? today
      const cell = cellFor(t.kind, day)
      if (cell && !cell.submission && cell.status !== "off" && cell.status !== "closed") {
        active = { kind: t.kind, day, cell }
        break
      }
    }
  } else {
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
      autoClosed: cell?.submission?.autoClosed ?? false,
      tasksDone: cell?.submission?.done ?? 0,
      tasksTotal: cell?.submission?.total ?? 0,
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
      canSubmit: practice || phase === "open" || phase === "late",
      submitFromLabel: minutesLabel(submitFromFor(t)),
      dueLabel: minutesLabel(dueAtFor(active.day, t)),
      sections: await loadSections(store.id, active.kind),
      marks: markStates(active.cell.marks),
      people: active.cell.people,
      practice,
    }
  }

  const upcoming = rows.find((r) => r.status === "upcoming")
  const upcomingTemplate = upcoming ? templates.find((x) => x.kind === upcoming.kind) : undefined

  return {
    store: { name: store.name },
    day: today,
    rows,
    active: activeCheck,
    next:
      upcoming && upcomingTemplate
        ? {
            label: upcoming.label,
            opensLabel: upcoming.opensLabel,
            opensAt: windowBounds(today, upcomingTemplate).opens.getTime(),
          }
        : null,
    closedToday: (grid?.preOpen ?? false) || (grid?.closedDays.includes(today) ?? false),
    practice,
    practiceSince: grid?.pausedSince ? grid.pausedSince.getTime() : null,
    serverNow: now.getTime(),
    version,
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
    markId: m.id,
  }))
}

export { loadSections }

/** The public link printed on a store's poster. */
export function checkLink(code: string): string {
  const base =
    process.env.CHECKS_BASE_URL ??
    `${(process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")}/checks`
  return `${base.replace(/\/$/, "")}/${code}`
}
