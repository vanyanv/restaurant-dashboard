import { prisma } from "@/lib/prisma"
import { JobStatus, type Prisma } from "@/generated/prisma/client"
import { loadCheckGrid } from "./data"
import { setChecksQuietUntil } from "./quiet"
import {
  addDays,
  CHECK_LABEL,
  dayLabel,
  dueAtFor,
  laInstant,
  clockLabel,
  todayLA,
  windowBounds,
  type CheckKindName,
  type CheckWindow,
} from "./time"

/**
 * Puts missed and late store checks on Needs you, as `Alert` rows: one per
 * store per business day, naming every check that day that went wrong, so a
 * bad day reads as one line instead of one card per check.
 *
 * Idempotent through `Alert.dedupeKey` (`STORE_CHECK:<store>:<day>`). A row
 * still OPEN is rewritten when a second check that day goes wrong; one the
 * owner already acknowledged or dismissed is reopened only for a check that
 * went wrong after that, never for the same news again. Pre-open stores
 * never get one, because their checks are "closed" in the grid. Runs from the
 * checks cron and whenever the owner opens Store checks.
 */

/**
 * One check that went wrong. `missed` is a check with nothing done; `partial`
 * closed itself with some tasks missed (`tasks` of them); `late` was all done
 * but after the due time.
 */
type Problem = { kind: CheckKindName; level: "missed" | "partial" | "late"; tasks?: number; line: string }

export function storeDayAlert(store: string, day: string, problems: Problem[]) {
  const label = (p: Problem) => CHECK_LABEL[p.kind].en
  const missed = problems.filter((p) => p.level === "missed")
  const partial = problems.filter((p) => p.level === "partial")
  const late = problems.filter((p) => p.level === "late")
  const names = (ps: Problem[]) => ps.map(label).join(" and ")
  const parts = [
    missed.length > 0 ? `${names(missed)} missed` : "",
    ...partial.map((p) => `${label(p)} ${p.tasks ?? 0} task${p.tasks === 1 ? "" : "s"} missed`),
    late.length > 0 ? `${names(late)} late` : "",
  ].filter(Boolean)
  return {
    severity: missed.length + partial.length > 0 ? ("WATCH" as const) : ("INFO" as const),
    title: `${store} · ${parts.join(", ")} · ${dayLabel(day)}`,
    body: problems.map((p) => p.line).join(" "),
  }
}

type PendingAlert = {
  dedupeKey: string
  storeId: string
  day: string
  problems: Problem[]
  alert: ReturnType<typeof storeDayAlert>
  metadata: { day: string; checks: Array<{ kind: CheckKindName; status: Problem["level"] }> }
}

export async function recordCheckAlerts(opts: {
  accountId?: string
  /** Only these accounts (the cron's gate, `checkAlertAccountsDue`). */
  accountIds?: string[]
  now: Date
  days?: number
}): Promise<{
  created: number
}> {
  const accounts = opts.accountId
    ? [{ id: opts.accountId }]
    : opts.accountIds
      ? opts.accountIds.map((id) => ({ id }))
      : await prisma.account.findMany({ select: { id: true } })
  const toDay = todayLA(opts.now)
  const fromDay = addDays(toDay, -(opts.days ?? 2))

  // Every store-day that has something wrong, across all accounts, so the
  // alerts that already exist are read in one query below rather than one
  // findUnique per store per day.
  const pending: PendingAlert[] = []
  for (const account of accounts) {
    const grid = await loadCheckGrid({ accountId: account.id, fromDay, toDay, now: opts.now })
    for (const store of grid) {
      const byDay = new Map<string, Problem[]>()
      for (const cell of store.cells) {
        if (cell.status !== "missed" && cell.status !== "partial" && cell.status !== "late") continue
        const tpl = store.templates.find((t) => t.kind === cell.kind)
        if (!tpl) continue
        const label = CHECK_LABEL[cell.kind].en
        const due = clockLabel(laInstant(cell.day, dueAtFor(cell.day, tpl)))
        const sub = cell.submission
        const closedAt = sub ? clockLabel(sub.submittedAt) : ""
        let problem: Problem
        if (cell.status === "partial" && sub) {
          problem = {
            kind: cell.kind,
            level: "partial",
            tasks: sub.missed.length,
            line: `${label} closed at ${closedAt} with ${sub.done} of ${sub.total} done. Missed: ${sub.missed.map((m) => m.item).join(", ")}.`,
          }
        } else if (cell.status === "missed") {
          problem = {
            kind: cell.kind,
            level: "missed",
            line: sub?.autoClosed
              ? `${label} closed at ${closedAt} with nothing ticked.`
              : `${label} was due by ${due} and nobody submitted it.`,
          }
        } else {
          problem = {
            kind: cell.kind,
            level: "late",
            line: sub?.autoClosed
              ? `${label} was all done, the last task ${sub.lateMinutes} min after ${due}.`
              : `${label} was sent ${sub?.lateMinutes ?? 0} min late by ${sub?.crewName || "crew"}.`,
          }
        }
        byDay.set(cell.day, [...(byDay.get(cell.day) ?? []), problem])
      }

      for (const [day, problems] of byDay) {
        pending.push({
          dedupeKey: `STORE_CHECK:${store.id}:${day}`,
          storeId: store.id,
          day,
          problems,
          alert: storeDayAlert(store.name, day, problems),
          metadata: { day, checks: problems.map((p) => ({ kind: p.kind, status: p.level })) },
        })
      }
    }
  }
  if (pending.length === 0) return { created: 0 }

  const existing = await prisma.alert.findMany({
    where: { dedupeKey: { in: pending.map((p) => p.dedupeKey) } },
    select: { id: true, dedupeKey: true, status: true, title: true, metadata: true },
  })
  const byKey = new Map(existing.map((e) => [e.dedupeKey, e]))

  const toCreate: PendingAlert[] = []
  const updates: Prisma.PrismaPromise<unknown>[] = []
  for (const p of pending) {
    const exists = byKey.get(p.dedupeKey)
    if (!exists) {
      toCreate.push(p)
      continue
    }
    const before = ((exists.metadata as { checks?: unknown[] } | null)?.checks ?? []).length
    if (exists.status === "OPEN" && exists.title !== p.alert.title) {
      updates.push(prisma.alert.update({ where: { id: exists.id }, data: { ...p.alert, metadata: p.metadata } }))
    } else if (exists.status !== "OPEN" && p.problems.length > before) {
      // A check that went wrong after the owner dealt with this day's
      // alert is news: reopen it, naming everything.
      updates.push(
        prisma.alert.update({
          where: { id: exists.id },
          data: { ...p.alert, metadata: p.metadata, status: "OPEN", acknowledgedAt: null, detectedAt: new Date() },
        }),
      )
    }
  }

  let created = 0
  if (toCreate.length > 0) {
    // skipDuplicates: a concurrent run (the cron and an owner opening Store
    // checks) may create the same day's alert first; that one stands.
    const res = await prisma.alert.createMany({
      data: toCreate.map((p) => ({
        storeId: p.storeId,
        source: "STORE_CHECK" as const,
        target: "STORE_CHECK" as const,
        targetId: null,
        ...p.alert,
        metadata: p.metadata,
        occurredOn: new Date(`${p.day}T00:00:00.000Z`),
        dedupeKey: p.dedupeKey,
      })),
      skipDuplicates: true,
    })
    created = res.count
  }
  if (updates.length > 0) await prisma.$transaction(updates)
  return { created }
}

/** The job name the checks cron records its runs under. */
export const CHECK_ALERTS_JOB = "checks.alerts"

/**
 * Slack on "since the last run": the last run's start, minus this. A window
 * that ended while that run was loading is looked at again rather than
 * possibly never.
 */
const GATE_MARGIN_MS = 5 * 60_000
/**
 * Load the grid at least this often whatever the gate sees. Un-marking a
 * closed day deletes its CheckClosure row, which leaves no timestamp to
 * notice, so a day that becomes "missed" that way is picked up within this.
 */
const GATE_MAX_SKIP_MS = 2 * 60 * 60_000

/**
 * Whether a check window can have produced anything for the cron since
 * `since`: its due-to-close span (the late phase, then the close) overlaps
 * (since, now]. That covers a window that went past due (a late submission
 * can arrive), one still in its grace period now, and one that closed — which
 * is when `loadCheckGrid` auto-closes it and a miss or partial appears. A
 * window still open, or not yet open, can only be on time, so it is not news.
 *
 * Evening windows past midnight belong to the day they opened, so the caller
 * passes the days from before yesterday on.
 */
export function windowMovedSince(day: string, w: CheckWindow, since: Date, now: Date): boolean {
  const b = windowBounds(day, w)
  return b.due.getTime() <= now.getTime() && b.closes.getTime() > since.getTime()
}

/**
 * The accounts the checks cron must load the grid for, or null for "all of
 * them". The grid load (setup, six reads per account, auto-close, alert
 * writes) is the cron's whole cost, and most half-hours nothing has happened
 * to any check: Morning and Night windows end a couple of times a day.
 *
 * Conservative by construction — every doubt answers "run":
 *  - no successful run on record: all accounts;
 *  - an active store with no checks set up yet: its account (the grid load
 *    sets them up);
 *  - a checklist window edited since the last run: its account;
 *  - a window whose due-to-close span overlaps the time since the last
 *    successful run started (minus a margin): its account.
 *
 * Reads two things: the last SUCCESS run (JobRun `[jobName, startedAt]`
 * index) and every active store's check windows.
 */
export async function checkAlertAccountsDue(now: Date): Promise<string[] | null> {
  const last = await prisma.jobRun.findFirst({
    where: { jobName: CHECK_ALERTS_JOB, status: JobStatus.SUCCESS },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  })
  if (!last) return null
  if (now.getTime() - last.startedAt.getTime() > GATE_MAX_SKIP_MS) return null
  const since = new Date(last.startedAt.getTime() - GATE_MARGIN_MS)

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: {
      accountId: true,
      // Lifecycle stage (pre-open stores have no missed checks) lives on the row.
      updatedAt: true,
      // A day marked closed, or checks paused or resumed, changes which
      // windows count as missed without moving any window.
      checkClosures: { where: { createdAt: { gt: since } }, select: { id: true }, take: 1 },
      checkPauses: {
        where: { OR: [{ pausedAt: { gt: since } }, { resumedAt: { gt: since } }] },
        select: { id: true },
        take: 1,
      },
      checkTemplates: {
        select: {
          opensAtMin: true,
          submitFromMin: true,
          dueAtMin: true,
          dueByWeekday: true,
          graceMin: true,
          enabled: true,
          updatedAt: true,
        },
      },
    },
  })

  const today = todayLA(now)
  const days = [addDays(today, -2), addDays(today, -1), today]
  const due = new Set<string>()
  for (const store of stores) {
    if (due.has(store.accountId)) continue
    const moved =
      store.checkTemplates.length === 0 ||
      store.updatedAt.getTime() > since.getTime() ||
      store.checkClosures.length > 0 ||
      store.checkPauses.length > 0 ||
      store.checkTemplates.some(
        (t) =>
          t.updatedAt.getTime() > since.getTime() ||
          (t.enabled && days.some((d) => windowMovedSince(d, t, since, now))),
      )
    if (moved) due.add(store.accountId)
  }

  // Nothing to do: until the next window goes past due (or the forced run),
  // the answer stays "nothing", so the cron can take it from Redis (quiet.ts).
  // Tomorrow is included for a run late in the day; the cap keeps it within 2 hours.
  if (due.size === 0) {
    let until = last.startedAt.getTime() + GATE_MAX_SKIP_MS
    for (const store of stores)
      for (const t of store.checkTemplates) {
        if (!t.enabled) continue
        for (const d of [...days, addDays(today, 1)]) {
          const at = windowBounds(d, t).due.getTime()
          if (at > now.getTime() && at < until) until = at
        }
      }
    await setChecksQuietUntil(new Date(until), now)
  } else {
    await setChecksQuietUntil(null)
  }
  return [...due]
}
