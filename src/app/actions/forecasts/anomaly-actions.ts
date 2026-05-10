"use server"

import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

export type AnomalyTarget = "REVENUE" | "MENU_ITEM" | "INGREDIENT" | "LABOR" | "REFUNDS"
export type AnomalyMethod = "ZSCORE" | "ISOLATION_FOREST"
export type AnomalyStatus = "OPEN" | "ACKNOWLEDGED" | "EXPLAINED"

export interface AnomalyEvent {
  id: string
  storeId: string
  /** Populated in aggregate mode (multiple stores in scope). */
  storeName?: string
  target: AnomalyTarget
  targetId: string | null
  occurredOn: Date
  residual: number
  zScore: number | null
  method: AnomalyMethod
  status: AnomalyStatus
  detectedAt: Date
}

export interface OpenAnomaliesData {
  /** Null when aggregating across all stores. */
  storeId: string | null
  storeName: string
  events: AnomalyEvent[]
}

export type GetOpenAnomaliesResult =
  | { ok: true; data: OpenAnomaliesData }
  | { ok: false; error: "store_not_in_account" }

export async function getOpenAnomalies(input: {
  storeId?: string
  limit?: number
}): Promise<GetOpenAnomaliesResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut, storeNameById } = resolved.ctx

  const limit = input.limit ?? 20
  const events = await prisma.anomalyEvent.findMany({
    where: { storeId: { in: storeIds }, status: "OPEN" },
    orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      storeId: true,
      target: true,
      targetId: true,
      occurredOn: true,
      residual: true,
      zScore: true,
      method: true,
      status: true,
      detectedAt: true,
    },
  })

  const isAggregate = storeIds.length > 1
  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      events: events.map((e) => ({
        id: e.id,
        storeId: e.storeId,
        ...(isAggregate && storeNameById.has(e.storeId)
          ? { storeName: storeNameById.get(e.storeId)! }
          : {}),
        target: e.target as AnomalyTarget,
        targetId: e.targetId,
        occurredOn: e.occurredOn,
        residual: e.residual,
        zScore: e.zScore,
        method: e.method as AnomalyMethod,
        status: e.status as AnomalyStatus,
        detectedAt: e.detectedAt,
      })),
    },
  }
}

export type AcknowledgeAnomalyResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_in_account" }

export async function acknowledgeAnomaly(input: {
  anomalyId: string
  explanation?: string | null
}): Promise<AcknowledgeAnomalyResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const event = await prisma.anomalyEvent.findUnique({
    where: { id: input.anomalyId },
    select: { id: true, store: { select: { accountId: true } } },
  })
  if (!event) return { ok: false, error: "not_found" }
  if (event.store.accountId !== user.accountId) return { ok: false, error: "not_in_account" }

  await prisma.anomalyEvent.update({
    where: { id: input.anomalyId },
    data: {
      status: input.explanation ? "EXPLAINED" : "ACKNOWLEDGED",
      explanation: input.explanation ?? null,
      acknowledgedAt: new Date(),
    },
  })
  return { ok: true }
}
