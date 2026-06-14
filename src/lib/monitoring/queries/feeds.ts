// Merged event feeds — the activity list (syncs + errors), the hourly login
// rollup, and the command-bridge recent-events feed (syncs + errors + logins).

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { windowFromArg, truncLiteral, type TimeWindow } from "../time-range"

export type ActivityRow = {
  id: string
  occurredAt: Date
  kind: "sync" | "error"
  label: string                // job name or error route
  detail: string | null        // status word, error message, etc.
  isFailure: boolean
}

export async function getRecentActivity(limit = 20): Promise<ActivityRow[]> {
  const [syncs, errors] = await Promise.all([
    prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, jobName: true, status: true, rowsWritten: true, errorMessage: true },
    }),
    prisma.errorEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, occurredAt: true, source: true, route: true, message: true },
    }),
  ])

  const merged: ActivityRow[] = [
    ...syncs.map((s): ActivityRow => ({
      id: `sync-${s.id}`,
      occurredAt: s.startedAt,
      kind: "sync",
      label: s.jobName,
      detail: s.status === "FAILURE" ? (s.errorMessage ?? "failed") : `${s.status?.toLowerCase() ?? "—"}${s.rowsWritten != null ? ` · ${s.rowsWritten} rows` : ""}`,
      isFailure: s.status === "FAILURE",
    })),
    ...errors.map((e): ActivityRow => ({
      id: `err-${e.id}`,
      occurredAt: e.occurredAt,
      kind: "error",
      label: e.route ?? e.source,
      detail: e.message.slice(0, 120),
      isFailure: true,
    })),
  ]

  merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  return merged.slice(0, limit)
}

/** Login rollup (succeeded vs failed) bucketed by hour (legacy `hours` arg) or
 * by the bucket of a {@link TimeWindow} from the global range control. */
export async function getLoginsByHour(arg: number | TimeWindow = 24) {
  const { since, until, bucket } = windowFromArg(arg)
  const rows = await prisma.$queryRaw<
    { bucket: Date; succeeded: bigint; failed: bigint }[]
  >`
    SELECT
      date_trunc(${Prisma.raw(truncLiteral(bucket))}, "createdAt") AS bucket,
      SUM(CASE WHEN kind = 'SIGN_IN'        THEN 1 ELSE 0 END)::bigint AS succeeded,
      SUM(CASE WHEN kind = 'SIGN_IN_FAILED' THEN 1 ELSE 0 END)::bigint AS failed
    FROM "LoginEvent"
    WHERE "createdAt" >= ${since} AND "createdAt" <= ${until}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({
    bucket: r.bucket,
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
  }))
}

export type BridgeEventRow = {
  id: string
  occurredAt: Date
  kind: "sync" | "error" | "login"
  system: "syncs" | "auth" | "db" | "r2" | "cache" | "other"
  sourceLabel: string
  description: string
  isFailure: boolean
}

/** Build the bridge's recent-events feed (Row 4) from Prisma. */
export async function getBridgeEvents(limit = 10): Promise<BridgeEventRow[]> {
  const since = new Date(Date.now() - 24 * 3600_000)
  const [syncs, errors, logins] = await Promise.all([
    prisma.jobRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { id: true, startedAt: true, jobName: true, status: true, errorMessage: true, rowsWritten: true },
    }),
    prisma.errorEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, occurredAt: true, source: true, route: true, message: true, status: true },
    }),
    prisma.loginEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, createdAt: true, emailTried: true, kind: true, ipAddress: true },
    }),
  ])

  const merged: BridgeEventRow[] = [
    ...syncs.map((s): BridgeEventRow => ({
      id: `sync-${s.id}`,
      occurredAt: s.startedAt,
      kind: "sync",
      system: "syncs",
      sourceLabel: "SYNC",
      description:
        s.status === "FAILURE"
          ? `${s.jobName} failed${s.errorMessage ? ` — ${s.errorMessage.slice(0, 80)}` : ""}`
          : `${s.jobName} ${s.status?.toLowerCase() ?? "—"}${s.rowsWritten != null ? ` (${s.rowsWritten} rows)` : ""}`,
      isFailure: s.status === "FAILURE",
    })),
    ...errors.map((e): BridgeEventRow => ({
      id: `err-${e.id}`,
      occurredAt: e.occurredAt,
      kind: "error",
      system: "other",
      sourceLabel: "ERROR",
      description: `${e.route ?? e.source}${e.status ? ` ${e.status}` : ""} — ${e.message.slice(0, 100)}`,
      isFailure: true,
    })),
    ...logins.map((l): BridgeEventRow => ({
      id: `login-${l.id}`,
      occurredAt: l.createdAt,
      kind: "login",
      system: "auth",
      sourceLabel: "AUTH",
      description:
        l.kind === "SIGN_IN_FAILED"
          ? `Failed sign-in for ${l.emailTried}${l.ipAddress ? ` from ${l.ipAddress}` : ""}`
          : l.kind === "SIGN_OUT"
          ? `Sign-out ${l.emailTried}`
          : `Sign-in ${l.emailTried}${l.ipAddress ? ` from ${l.ipAddress}` : ""}`,
      isFailure: l.kind === "SIGN_IN_FAILED",
    })),
  ]

  merged.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  return merged.slice(0, limit)
}
