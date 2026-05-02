import { prisma } from "@/lib/prisma"
import { getDbSize } from "./db-stats"
import { getCacheHitRateByDay } from "./queries"
import { getLatestVercelSnapshot, type VercelUsageMetrics } from "./vercel-usage"
import { getLatestR2Snapshot } from "./r2-stats"
import { getLivePresence } from "./login-audit"
import type { System } from "@/components/monitoring/system-color"

export type SystemStatus = {
  system: System
  tone: "ok" | "warn" | "danger"
  headline: string
  caption: string | null
}

function fmtBytes(n: number | bigint): string {
  const v = typeof n === "bigint" ? Number(n) : n
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function dbStatus(): Promise<SystemStatus> {
  const size = await getDbSize()
  const tone = size.pct >= 90 ? "danger" : size.pct >= 70 ? "warn" : "ok"
  return {
    system: "db",
    tone,
    headline: `${Math.round(size.pct)}%`,
    caption: `${fmtBytes(size.totalBytes)} / ${fmtBytes(size.capBytes)}`,
  }
}

async function vercelStatus(): Promise<SystemStatus> {
  const snap = await getLatestVercelSnapshot()
  if (!snap) {
    return { system: "vercel", tone: "ok", headline: "—", caption: "no data yet" }
  }
  const metrics = snap.metrics as unknown as VercelUsageMetrics
  let total = 0
  let healthy = 0
  let capped = 0
  for (const q of Object.values(metrics)) {
    if (q.used == null || q.limit == null || q.limit === 0) continue
    total += 1
    const pct = (q.used / q.limit) * 100
    if (pct >= 100) capped += 1
    if (pct < 70) healthy += 1
  }
  const tone = capped > 0 ? "danger" : healthy < total ? "warn" : "ok"
  const headline =
    total === 0 ? "—" : capped > 0 ? `${capped} CAP` : `${healthy}/${total} OK`
  return { system: "vercel", tone, headline, caption: total === 0 ? "no data" : "current cycle" }
}

async function r2Status(): Promise<SystemStatus> {
  const snap = await getLatestR2Snapshot()
  if (!snap) {
    return { system: "r2", tone: "ok", headline: "—", caption: "no snapshot yet" }
  }
  return {
    system: "r2",
    tone: "ok",
    headline: fmtBytes(snap.totalBytes),
    caption: `${snap.objectCount.toLocaleString()} objs`,
  }
}

async function cacheStatus(): Promise<SystemStatus> {
  const days = await getCacheHitRateByDay(1)
  const pct = days[days.length - 1]?.hitPct ?? 0
  const tone = pct < 30 && pct > 0 ? "warn" : "ok"
  return {
    system: "cache",
    tone,
    headline: `${Math.round(pct)}%`,
    caption: "hit rate · 1d",
  }
}

async function authStatus(): Promise<SystemStatus> {
  const presence = await getLivePresence()
  return {
    system: "auth",
    tone: "ok",
    headline:
      presence.length === 0
        ? "0 ONLINE"
        : `${presence.length} ONLINE`,
    caption: presence.length > 0 ? presence[0].email : "no active sessions",
  }
}

async function syncsStatus(): Promise<SystemStatus> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recent = await prisma.jobRun.findMany({
    where: { startedAt: { gte: since } },
    select: { status: true },
    take: 200,
  })
  const failed = recent.filter((r) => r.status === "FAILURE").length
  const ok = recent.filter((r) => r.status === "SUCCESS").length
  const tone = failed > 0 ? "danger" : "ok"
  return {
    system: "syncs",
    tone,
    headline: failed > 0 ? `${failed} FAIL` : "OK",
    caption: `${ok} ok · 24h`,
  }
}

/** Run all subsystem checks in parallel. Each handler must not throw —
 * a thrown one becomes a danger pill rather than tanking the strip. */
export async function getAllSystemStatus(): Promise<SystemStatus[]> {
  return Promise.all([
    safe("db", dbStatus),
    safe("vercel", vercelStatus),
    safe("r2", r2Status),
    safe("cache", cacheStatus),
    safe("auth", authStatus),
    safe("syncs", syncsStatus),
  ])
}

function safe(
  system: System,
  fn: () => Promise<SystemStatus>,
): Promise<SystemStatus> {
  return fn().catch((err) => {
    console.error(`[system-status] ${system} failed`, err)
    return {
      system,
      tone: "danger",
      headline: "ERR",
      caption: err instanceof Error ? err.message.slice(0, 40) : "unknown",
    }
  })
}
