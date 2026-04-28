import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { runPhasePrompt, type RunPhasePromptArgs } from "./orchestrator"
import type {
  AiAnalyticsRoute,
  AiAnalyticsScope,
} from "@/generated/prisma/client"

/**
 * Shared cron-handler wrapper for the START phase of the phased AI analytics
 * pipeline. Each per-route POST handler delegates to this with its
 * route-specific source-data fetcher and prompt builders. The wrapper handles
 * auth, scope resolution, and ownerId lookup, then runs Phase 1 (prompt) and
 * returns `{ runId, nextStep: "generate" }` so the caller can chain into the
 * route-agnostic `/api/cron/ai-analytics/run/[id]/generate` and `.../critique`
 * endpoints.
 */

interface BuildHandlerArgs<TSource> {
  route: AiAnalyticsRoute
  fetchSourceData: (storeId: string | null, ownerId: string) => Promise<TSource>
  buildSystemPrompt: () => string
  buildUserPrompt: (args: { source: TSource; memoryBlock: string }) => string
  buildSourceSummary: (source: TSource) => string
  collectAllowedEntities?: (source: TSource) => string[]
  materialityThresholdDollars: number
  validateEntities: boolean
}

export function makeAiAnalyticsCronHandler<TSource>(
  args: BuildHandlerArgs<TSource>,
) {
  return async function handler(request: NextRequest) {
    if (!isCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const storeIdParam = url.searchParams.get("storeId")
    const scopeParam = url.searchParams.get("scope")
    const isRollup = scopeParam === "all"
    const storeId = isRollup ? null : storeIdParam

    if (!isRollup && !storeId) {
      return NextResponse.json(
        { error: "Either ?storeId=<id> or ?scope=all is required" },
        { status: 400 },
      )
    }

    let ownerId: string
    if (storeId) {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { ownerId: true },
      })
      if (!store) {
        return NextResponse.json(
          { error: `Store ${storeId} not found` },
          { status: 404 },
        )
      }
      ownerId = store.ownerId
    } else {
      const anyActive = await prisma.store.findFirst({
        where: { isActive: true },
        select: { ownerId: true },
      })
      if (!anyActive) {
        return NextResponse.json({ error: "No active stores" }, { status: 404 })
      }
      ownerId = anyActive.ownerId
    }

    const result = await runPhasePrompt<TSource>({
      route: args.route,
      scope: isRollup ? "ALL" : "STORE",
      storeId,
      fetchSourceData: () => args.fetchSourceData(storeId, ownerId),
      buildSystemPrompt: args.buildSystemPrompt,
      buildUserPrompt: args.buildUserPrompt,
      buildSourceSummary: args.buildSourceSummary,
      collectAllowedEntities: args.collectAllowedEntities,
      materialityThresholdDollars: args.materialityThresholdDollars,
      validateEntities: args.validateEntities,
    } satisfies RunPhasePromptArgs<TSource>)

    return NextResponse.json(result)
  }
}

/** Re-export for routes that don't want to import the scope type directly. */
export type { AiAnalyticsScope }
