import { prisma } from "@/lib/prisma"
import { loadCheckGrid } from "./data"
import { addDays, CHECK_LABEL, dayLabel, dueAtFor, laInstant, clockLabel, todayLA, type CheckKindName } from "./time"

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

export async function recordCheckAlerts(opts: { accountId?: string; now: Date; days?: number }): Promise<{
  created: number
}> {
  const accounts = opts.accountId
    ? [{ id: opts.accountId }]
    : await prisma.account.findMany({ select: { id: true } })
  const toDay = todayLA(opts.now)
  const fromDay = addDays(toDay, -(opts.days ?? 2))
  let created = 0

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
        const alert = storeDayAlert(store.name, day, problems)
        const metadata = { day, checks: problems.map((p) => ({ kind: p.kind, status: p.level })) }
        const dedupeKey = `STORE_CHECK:${store.id}:${day}`
        const exists = await prisma.alert.findUnique({
          where: { dedupeKey },
          select: { id: true, status: true, title: true, metadata: true },
        })
        if (exists) {
          const before = ((exists.metadata as { checks?: unknown[] } | null)?.checks ?? []).length
          if (exists.status === "OPEN" && exists.title !== alert.title) {
            await prisma.alert.update({ where: { id: exists.id }, data: { ...alert, metadata } })
          } else if (exists.status !== "OPEN" && problems.length > before) {
            // A check that went wrong after the owner dealt with this day's
            // alert is news: reopen it, naming everything.
            await prisma.alert.update({
              where: { id: exists.id },
              data: { ...alert, metadata, status: "OPEN", acknowledgedAt: null, detectedAt: new Date() },
            })
          }
          continue
        }
        await prisma.alert
          .create({
            data: {
              storeId: store.id,
              source: "STORE_CHECK",
              target: "STORE_CHECK",
              targetId: null,
              ...alert,
              metadata,
              occurredOn: new Date(`${day}T00:00:00.000Z`),
              dedupeKey,
            },
          })
          .then(
            () => {
              created += 1
            },
            (err: unknown) => {
              // A concurrent run created it first.
              if ((err as { code?: string }).code !== "P2002") throw err
            },
          )
      }
    }
  }
  return { created }
}
