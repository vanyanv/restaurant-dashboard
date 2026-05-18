"use server"

import { prisma } from "@/lib/prisma"
import type { GrowthOpportunity } from "@/types/growth"
import { getCachedSession, resolveStoreContext } from "@/app/actions/forecasts/_shared"

export interface GetOpportunitiesResult {
  ok: boolean
  storeId: string | null
  storeName: string
  lifecycleStage: "pre_open" | "warming_up" | "ready" | null
  asOfDate: Date | null
  opportunities: GrowthOpportunity[]
}

/**
 * Returns the latest growth opportunities for a store (or all stores when
 * storeId is omitted). Restricts to `lifecycleStage = 'ready'` stores per
 * spec §3 — warming_up / pre_open get an empty list and a lifecycleStage
 * tag the page uses to render the appropriate empty state.
 */
export async function getOpportunities(input: {
  storeId?: string
  asOfDate?: Date
}): Promise<GetOpportunitiesResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) {
    return {
      ok: false, storeId: null, storeName: "—",
      lifecycleStage: null, asOfDate: null, opportunities: [],
    }
  }
  const { storeIds, storeName, storeIdOut } = resolved.ctx

  // Lifecycle gate.
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, lifecycleStage: true },
  })
  const anyReady = stores.some((s) => s.lifecycleStage === "ready")
  const lifecycleStage = storeIdOut
    ? (stores.find((s) => s.id === storeIdOut)?.lifecycleStage ?? null)
    : (anyReady ? "ready" : (stores[0]?.lifecycleStage ?? null))
  if (!anyReady) {
    return {
      ok: true, storeId: storeIdOut, storeName, lifecycleStage,
      asOfDate: null, opportunities: [],
    }
  }

  const asOfDate = input.asOfDate ?? new Date()
  // Latest row per (store, type, title) on or before asOfDate.
  const rows = await prisma.growthOpportunity.findMany({
    where: {
      storeId: {
        in: storeIds.filter(
          (id) => stores.find((s) => s.id === id)?.lifecycleStage === "ready",
        ),
      },
      asOfDate: { lte: asOfDate },
    },
    orderBy: [{ asOfDate: "desc" }, { estimatedDollarImpact: "desc" }],
    take: 200,
  })

  // Take only the most recent asOfDate's rows.
  const mostRecent = rows[0]?.asOfDate ?? null
  const filtered = mostRecent
    ? rows.filter(
        (r) =>
          r.asOfDate.toISOString().slice(0, 10) ===
          mostRecent.toISOString().slice(0, 10),
      )
    : []

  const opportunities: GrowthOpportunity[] = filtered.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    asOfDate: r.asOfDate,
    opportunityType: r.opportunityType as GrowthOpportunity["opportunityType"],
    title: r.title,
    estimatedDollarImpact: r.estimatedDollarImpact,
    confidence: r.confidence as GrowthOpportunity["confidence"],
    evidence: (r.evidence ?? []) as unknown as GrowthOpportunity["evidence"],
    caveats: r.caveats,
    suggestedAction: r.suggestedAction,
    createdAt: r.createdAt,
  }))

  return {
    ok: true, storeId: storeIdOut, storeName, lifecycleStage,
    asOfDate: mostRecent, opportunities,
  }
}
