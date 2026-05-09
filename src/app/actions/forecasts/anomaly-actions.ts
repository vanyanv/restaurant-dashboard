"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

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
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  let storeIds: string[]
  let storeName: string
  let storeIdOut: string | null
  const storeNameById = new Map<string, string>()
  if (input.storeId) {
    const store = await prisma.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, name: true, accountId: true },
    })
    if (!store || store.accountId !== user.accountId) {
      return { ok: false, error: "store_not_in_account" }
    }
    storeIds = [store.id]
    storeName = store.name
    storeIdOut = store.id
    storeNameById.set(store.id, store.name)
  } else {
    const stores = await prisma.store.findMany({
      where: { accountId: user.accountId, isActive: true },
      select: { id: true, name: true },
    })
    storeIds = stores.map((s) => s.id)
    for (const s of stores) storeNameById.set(s.id, s.name)
    storeName = "All stores"
    storeIdOut = null
  }

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
  const session = (await getServerSession(authOptions)) as SessionLike | null
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
