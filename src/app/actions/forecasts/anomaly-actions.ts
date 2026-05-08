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
  storeId: string
  storeName: string
  events: AnomalyEvent[]
}

export type GetOpenAnomaliesResult =
  | { ok: true; data: OpenAnomaliesData }
  | { ok: false; error: "store_not_in_account" }

export async function getOpenAnomalies(input: {
  storeId: string
  limit?: number
}): Promise<GetOpenAnomaliesResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, name: true, accountId: true },
  })
  if (!store || store.accountId !== user.accountId) {
    return { ok: false, error: "store_not_in_account" }
  }

  const limit = input.limit ?? 20
  const events = await prisma.anomalyEvent.findMany({
    where: { storeId: input.storeId, status: "OPEN" },
    orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
    take: limit,
    select: {
      id: true,
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

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      events: events.map((e) => ({
        id: e.id,
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
