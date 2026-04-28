import { prisma } from "@/lib/prisma"
import type {
  AiAnalyticsRoute,
  AiAnalyticsScope,
} from "@/generated/prisma/client"

/**
 * Read helpers for the AI analytics pages. Each page is a server component
 * that calls one of these to load the latest persisted run + insights for
 * the user's current scope (selected store or all-stores rollup).
 *
 * The query is "give me the most recent OK or PARTIAL run for this (route,
 * scope, storeId)" and "give me its insights." A FAILED run is skipped — the
 * page renders the prior good run (if any) plus a "stale" stamp.
 */

export interface PageInsight {
  id: string
  headline: string
  body: string
  severity: "INFO" | "WATCH" | "ALERT"
  impactDollars: number | null
  generatedAt: Date
}

export interface PageRunMeta {
  runId: string
  status: "OK" | "PARTIAL" | "FAILED"
  generatedAt: Date
  insightCount: number
  droppedByCritic: number
}

export interface AiPageData {
  route: AiAnalyticsRoute
  scope: AiAnalyticsScope
  storeId: string | null
  /** Most recent OK / PARTIAL run for this (route, scope, storeId) — null if
   * the cron has never produced a good run for this scope yet. */
  latestRun: PageRunMeta | null
  /** Insights from `latestRun` ordered by severity (ALERT > WATCH > INFO)
   * then by impactDollars desc. Empty when latestRun is null. */
  insights: PageInsight[]
  /** True when the most recent run was FAILED — page should show a "stale" or
   * "data unavailable" stamp alongside whatever older insights it has. */
  lastRunFailed: boolean
}

const SEVERITY_ORDER: Record<string, number> = { ALERT: 0, WATCH: 1, INFO: 2 }

export async function loadPageData(args: {
  route: AiAnalyticsRoute
  scope: AiAnalyticsScope
  storeId: string | null
}): Promise<AiPageData> {
  const lastTwo = await prisma.aiAnalyticsRun.findMany({
    where: {
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
    },
    orderBy: { startedAt: "desc" },
    take: 2,
    select: {
      id: true,
      status: true,
      startedAt: true,
      insightCount: true,
      droppedByCritic: true,
    },
  })

  const lastRunFailed = lastTwo[0]?.status === "FAILED"
  const goodRun = lastTwo.find((r) => r.status !== "FAILED") ?? null

  if (!goodRun) {
    return {
      route: args.route,
      scope: args.scope,
      storeId: args.storeId,
      latestRun: null,
      insights: [],
      lastRunFailed,
    }
  }

  const insights = await prisma.aiInsight.findMany({
    where: { runId: goodRun.id },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      headline: true,
      body: true,
      severity: true,
      impactDollars: true,
      generatedAt: true,
    },
  })

  insights.sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 99
    const sb = SEVERITY_ORDER[b.severity] ?? 99
    if (sa !== sb) return sa - sb
    const ia = a.impactDollars ?? 0
    const ib = b.impactDollars ?? 0
    return ib - ia
  })

  return {
    route: args.route,
    scope: args.scope,
    storeId: args.storeId,
    latestRun: {
      runId: goodRun.id,
      status: goodRun.status as "OK" | "PARTIAL" | "FAILED",
      generatedAt: goodRun.startedAt,
      insightCount: goodRun.insightCount,
      droppedByCritic: goodRun.droppedByCritic,
    },
    insights,
    lastRunFailed,
  }
}
