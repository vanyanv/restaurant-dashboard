import { prisma } from "@/lib/prisma"
import type { AiAnalyticsRoute, AiAnalyticsScope } from "@/generated/prisma/client"

/**
 * Insight memory — the v1 learning layer. Every cron run reads the trailing
 * window of saved insights for the same (route, scope, storeId) tuple and
 * passes them into the next generator prompt as recent-memory context. The
 * generator is told to:
 *
 *   - escalate any item that has been flagged repeatedly,
 *   - drop items that are no longer supported by current data,
 *   - avoid repeating verbatim what was already said.
 *
 * Memory is store-scoped on purpose: Hollywood's recurring beef issue should
 * not bleed into the rollup or other stores' prompts.
 */

const DEFAULT_LOOKBACK_DAYS = 14
const DEFAULT_LIMIT = 30

export interface MemoryQuery {
  route: AiAnalyticsRoute
  scope: AiAnalyticsScope
  storeId: string | null
  lookbackDays?: number
  limit?: number
}

export interface MemoryEntry {
  generatedAt: Date
  headline: string
  body: string
  severity: string
  impactDollars: number | null
}

export async function loadRecentInsights(query: MemoryQuery): Promise<MemoryEntry[]> {
  const lookbackDays = query.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const limit = query.limit ?? DEFAULT_LIMIT
  const since = new Date()
  since.setDate(since.getDate() - lookbackDays)

  const rows = await prisma.aiInsight.findMany({
    where: {
      route: query.route,
      scope: query.scope,
      storeId: query.storeId,
      generatedAt: { gte: since },
    },
    orderBy: { generatedAt: "desc" },
    take: limit,
    select: {
      generatedAt: true,
      headline: true,
      body: true,
      severity: true,
      impactDollars: true,
    },
  })

  return rows
}

/** Render a memory list as a compact prompt block. Designed to slot directly
 * into the generator user-prompt under a "## Recent insights you have already
 * flagged" heading. */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "(none — this is the first cron run for this route/store, no memory yet)"
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  })

  const lines = entries.map((e) => {
    const when = formatter.format(e.generatedAt)
    const impact = e.impactDollars != null ? ` ($${e.impactDollars.toFixed(0)})` : ""
    return `- [${when}] [${e.severity}] ${e.headline}${impact}`
  })

  return [
    "If any of the items below still apply given the current data, ESCALATE the severity (e.g. WATCH → ALERT) and note that it has persisted. If they have resolved, do not surface them again. Do not repeat any headline verbatim.",
    "",
    ...lines,
  ].join("\n")
}
