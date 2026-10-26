import { prisma } from "@/lib/prisma"
import { loadCheckGrid } from "./data"
import { addDays, CHECK_LABEL, dayLabel, dueAtFor, laInstant, clockLabel, todayLA } from "./time"

/**
 * Puts missed and late store checks on Needs you, as `Alert` rows.
 *
 * Idempotent through `Alert.dedupeKey`, and an owner's triage (acknowledged,
 * dismissed) survives a re-run because an existing row is never updated.
 * Runs from the checks cron and whenever the owner opens Store checks, so
 * Needs you is current without waiting for the cron.
 */
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
      for (const cell of store.cells) {
        if (cell.status !== "missed" && cell.status !== "late") continue
        const tpl = store.templates.find((t) => t.kind === cell.kind)
        if (!tpl) continue
        const label = CHECK_LABEL[cell.kind].en
        const due = clockLabel(laInstant(cell.day, dueAtFor(cell.day, tpl)))
        const missed = cell.status === "missed"
        const dedupeKey = `STORE_CHECK:${store.id}:${cell.kind}:${cell.day}`
        const exists = await prisma.alert.findUnique({ where: { dedupeKey }, select: { id: true } })
        if (exists) continue
        await prisma.alert.create({
          data: {
            storeId: store.id,
            source: "STORE_CHECK",
            target: "STORE_CHECK",
            targetId: cell.kind,
            severity: missed ? "WATCH" : "INFO",
            title: missed
              ? `${store.name} · ${label} check missed`
              : `${store.name} · ${label} check late by ${cell.submission?.lateMinutes ?? 0} min`,
            body: missed
              ? `Due ${dayLabel(cell.day)} at ${due}. Nobody submitted it.`
              : `Due ${dayLabel(cell.day)} at ${due}. Submitted by ${cell.submission?.crewName ?? "crew"}.`,
            metadata: { kind: cell.kind, day: cell.day, status: cell.status },
            occurredOn: new Date(`${cell.day}T00:00:00.000Z`),
            dedupeKey,
          },
        }).then(
          () => { created += 1 },
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
