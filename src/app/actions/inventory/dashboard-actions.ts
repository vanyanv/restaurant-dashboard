"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"
import { computeDailyDepletionRate } from "@/lib/inventory/depletion-rate"
import {
  computeReorderRecommendation,
  type ReorderStatus,
} from "@/lib/inventory/reorder-recommendation"
import { normalizeVendorName } from "@/lib/vendor-normalize"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

const DEFAULT_FALLBACK_LEAD_DAYS = 3

export interface InventoryDashboardRow {
  ingredientId: string
  ingredientName: string
  category: string
  recipeUnit: string
  onHand: number
  baseAt: Date | null
  ratePerDay: number
  windowDays: number
  daysOfCover: number | null
  status: ReorderStatus
  slackDays: number
  reorderBy: Date | null
  recentVendorNormalized: string | null
  recentVendorRaw: string | null
  leadDays: number
  leadSampleSize: number
  /** True if compute had to skip an unconvertible invoice unit. */
  partial: boolean
}

export interface InventoryDashboardData {
  storeId: string
  storeName: string
  asOf: Date
  rows: InventoryDashboardRow[]
}

export type GetInventoryDashboardResult =
  | { ok: true; data: InventoryDashboardData }
  | { ok: false; error: "store_not_in_account" }

export async function getInventoryDashboardData(input: {
  storeId: string
  asOf?: Date
}): Promise<GetInventoryDashboardResult | null> {
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

  const asOf = input.asOf ?? new Date()

  const [ingredients, leadTimeRows, recentLines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId: user.accountId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, recipeUnit: true },
    }),
    prisma.vendorLeadTime.findMany({
      where: { accountId: user.accountId },
      select: { vendorNameNormalized: true, medianLeadDays: true, sampleSize: true },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        invoice: { storeId: input.storeId },
        canonicalIngredientId: { not: null },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        canonicalIngredientId: true,
        invoice: { select: { vendorName: true } },
      },
    }),
  ])

  const leadTimeMap = new Map(
    leadTimeRows.map((r) => [
      r.vendorNameNormalized,
      { leadDays: r.medianLeadDays, sampleSize: r.sampleSize },
    ])
  )

  const vendorByIngredient = new Map<string, string>()
  for (const line of recentLines) {
    if (!line.canonicalIngredientId) continue
    if (vendorByIngredient.has(line.canonicalIngredientId)) continue
    vendorByIngredient.set(line.canonicalIngredientId, line.invoice.vendorName)
  }

  const rows = await Promise.all(
    ingredients.map(async (ing): Promise<InventoryDashboardRow> => {
      const [onHandResult, depletionResult] = await Promise.all([
        computeRunningOnHand({ storeId: input.storeId, ingredientId: ing.id, asOf }),
        computeDailyDepletionRate({ storeId: input.storeId, ingredientId: ing.id, asOf }),
      ])

      const onHand = onHandResult?.onHand ?? 0
      const baseAt = onHandResult?.baseAt ?? null
      const ratePerDay = depletionResult?.ratePerDay ?? 0
      const windowDays = depletionResult?.windowDays ?? 0

      const recentVendorRaw = vendorByIngredient.get(ing.id) ?? null
      const recentVendorNormalized = recentVendorRaw
        ? normalizeVendorName(recentVendorRaw)
        : null
      const lead =
        recentVendorNormalized && leadTimeMap.get(recentVendorNormalized)
          ? leadTimeMap.get(recentVendorNormalized)!
          : { leadDays: DEFAULT_FALLBACK_LEAD_DAYS, sampleSize: 0 }

      const reco = computeReorderRecommendation({
        onHand,
        ratePerDay,
        leadDays: lead.leadDays,
        asOf,
      })

      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        category: ing.category ?? "Uncategorized",
        recipeUnit: ing.recipeUnit ?? "",
        onHand,
        baseAt,
        ratePerDay,
        windowDays,
        daysOfCover: reco.daysOfCover,
        status: reco.status,
        slackDays: reco.slackDays,
        reorderBy: reco.reorderBy,
        recentVendorNormalized,
        recentVendorRaw,
        leadDays: lead.leadDays,
        leadSampleSize: lead.sampleSize,
        partial: onHandResult?.partial ?? false,
      }
    })
  )

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      asOf,
      rows,
    },
  }
}
