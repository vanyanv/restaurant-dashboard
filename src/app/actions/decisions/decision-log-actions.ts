"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { ymdUTC as ymd } from "@/lib/date-utils"
import type { OpportunityType } from "@/types/growth"
import type { FrozenDay } from "@/lib/decisions/decision-outcome"

/**
 * Recording what the owner decided, and freezing the counterfactual.
 *
 * "Mark done" lived in React state, so it forgot on refresh and nothing could
 * ever learn whether a recommendation had been worth making. Committing now
 * writes a row and, with it, the forecast for the days ahead exactly as it
 * stood *before* the decision — which is what makes "did it work?" answerable
 * later without an experiment.
 */

/** Days of forecast frozen at commit time. Long enough to judge a week. */
const FREEZE_HORIZON_DAYS = 14

export type DecisionActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "store_not_in_account" | "not_found" }

export interface DecisionRef {
  storeId: string
  opportunityType: OpportunityType
  opportunityTitle: string
  opportunityAsOf: string
  predictedImpactUsdPerWeek: number
  predictedImpactP10?: number | null
  predictedImpactP90?: number | null
}

async function authorize(storeId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false as const, error: "unauthorized" as const }
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, accountId: true },
  })
  if (!store) return { ok: false as const, error: "not_found" as const }
  if (store.accountId !== session.user.accountId) {
    return { ok: false as const, error: "store_not_in_account" as const }
  }
  return { ok: true as const, userId: session.user.id }
}

/**
 * The forecast as it stands right now, before the decision takes effect.
 *
 * Reads the newest generation only. Every row in it was generated before this
 * call, which is the whole basis of the comparison — a forecast written after
 * the fact would already contain the decision's effect and prove nothing.
 */
async function freezeForecast(storeId: string): Promise<FrozenDay[]> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const until = new Date(today)
  until.setUTCDate(until.getUTCDate() + FREEZE_HORIZON_DAYS)

  const rows = await prisma.forecastDailyRevenue.findMany({
    where: {
      storeId,
      hourBucket: 0,
      forecastDate: { gte: today, lte: until },
    },
    orderBy: { generatedAt: "desc" },
    take: FREEZE_HORIZON_DAYS * 4,
    select: {
      forecastDate: true,
      predictedRevenue: true,
      p10: true,
      p90: true,
      generatedAt: true,
    },
  })

  const seen = new Set<string>()
  const out: FrozenDay[] = []
  for (const r of rows) {
    const date = ymd(r.forecastDate)
    if (seen.has(date)) continue
    seen.add(date)
    out.push({
      date,
      predicted: r.predictedRevenue,
      p10: r.p10,
      p90: r.p90,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The owner is taking this action. Freezes the counterfactual alongside it.
 *
 * Upsert rather than insert: re-deciding the same opportunity replaces the
 * previous call, and re-freezes, because the relevant counterfactual is the one
 * from the moment the owner actually committed.
 */
export async function commitDecision(input: DecisionRef): Promise<DecisionActionResult> {
  const auth = await authorize(input.storeId)
  if (!auth.ok) return auth

  const frozen = await freezeForecast(input.storeId)
  const key = {
    storeId_opportunityType_opportunityTitle: {
      storeId: input.storeId,
      opportunityType: input.opportunityType,
      opportunityTitle: input.opportunityTitle,
    },
  }
  const shared = {
    opportunityAsOf: new Date(`${input.opportunityAsOf}T00:00:00Z`),
    state: "COMMITTED" as const,
    dismissReason: null,
    decidedByUserId: auth.userId,
    decidedAt: new Date(),
    predictedImpactUsdPerWeek: input.predictedImpactUsdPerWeek,
    predictedImpactP10: input.predictedImpactP10 ?? null,
    predictedImpactP90: input.predictedImpactP90 ?? null,
    // Prisma's JSON input type has no structural overlap with a typed array,
    // so the shape is asserted here and re-validated on read.
    frozenForecast:
      frozen.length > 0 ? (frozen as unknown as Prisma.InputJsonValue) : undefined,
  }

  await prisma.decisionLog.upsert({
    where: key,
    create: {
      storeId: input.storeId,
      opportunityType: input.opportunityType,
      opportunityTitle: input.opportunityTitle,
      ...shared,
    },
    update: shared,
  })

  revalidatePath("/dashboard/decisions")
  return { ok: true }
}

/**
 * The owner is passing on this one. A reason is optional but wanted: an owner
 * who skips every menu-engineering card for two months is telling the ranker
 * something no accuracy metric captures.
 *
 * No forecast is frozen — there is no effect to measure.
 */
export async function dismissDecision(
  input: DecisionRef & { reason?: string },
): Promise<DecisionActionResult> {
  const auth = await authorize(input.storeId)
  if (!auth.ok) return auth

  const shared = {
    opportunityAsOf: new Date(`${input.opportunityAsOf}T00:00:00Z`),
    state: "DISMISSED" as const,
    dismissReason: input.reason?.trim() || null,
    decidedByUserId: auth.userId,
    decidedAt: new Date(),
    predictedImpactUsdPerWeek: input.predictedImpactUsdPerWeek,
    predictedImpactP10: input.predictedImpactP10 ?? null,
    predictedImpactP90: input.predictedImpactP90 ?? null,
  }

  await prisma.decisionLog.upsert({
    where: {
      storeId_opportunityType_opportunityTitle: {
        storeId: input.storeId,
        opportunityType: input.opportunityType,
        opportunityTitle: input.opportunityTitle,
      },
    },
    create: {
      storeId: input.storeId,
      opportunityType: input.opportunityType,
      opportunityTitle: input.opportunityTitle,
      ...shared,
    },
    update: shared,
  })

  revalidatePath("/dashboard/decisions")
  return { ok: true }
}

/** Undo — the card returns to the open ledger and the record is removed. */
export async function undoDecision(input: {
  storeId: string
  opportunityType: OpportunityType
  opportunityTitle: string
}): Promise<DecisionActionResult> {
  const auth = await authorize(input.storeId)
  if (!auth.ok) return auth

  await prisma.decisionLog.deleteMany({
    where: {
      storeId: input.storeId,
      opportunityType: input.opportunityType,
      opportunityTitle: input.opportunityTitle,
    },
  })

  revalidatePath("/dashboard/decisions")
  return { ok: true }
}
