"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { canonicalizeUnit } from "@/lib/unit-conversion"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

const COVERAGE_LOOKBACK_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface InventoryCoverageHealthData {
  storeId: string
  storeName: string
  windowStart: Date
  windowEnd: Date
  totalSalesRevenue: number
  mappedRevenue: number
  unmappedRevenue: number
  /** mappedRevenue / totalSalesRevenue. Null when there were zero sales. */
  coveragePct: number | null
  /** SKU matches with cross-unit (fromUnit, toUnit) still on the default factor 1 — a likely-bogus passthrough. */
  conversionGapCount: number
}

export type GetInventoryCoverageHealthResult =
  | { ok: true; data: InventoryCoverageHealthData }
  | { ok: false; error: "store_not_in_account" }

export async function getInventoryCoverageHealth(input: {
  storeId: string
  asOf?: Date
}): Promise<GetInventoryCoverageHealthResult | null> {
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

  const windowEnd = input.asOf ?? new Date()
  const windowStart = new Date(windowEnd.getTime() - COVERAGE_LOOKBACK_DAYS * MS_PER_DAY)

  const [byStatus, skuMatches] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["status"],
      where: {
        storeId: input.storeId,
        date: { gte: windowStart, lte: windowEnd },
      },
      _sum: { salesRevenue: true },
    }),
    prisma.ingredientSkuMatch.findMany({
      where: { accountId: user.accountId },
      select: { id: true, fromUnit: true, toUnit: true, conversionFactor: true },
    }),
  ])

  let costedRevenue = 0
  let missingCostRevenue = 0
  let unmappedRevenue = 0
  for (const row of byStatus) {
    const sum = row._sum?.salesRevenue ?? 0
    if (row.status === "COSTED") costedRevenue += sum
    else if (row.status === "MISSING_COST") missingCostRevenue += sum
    else if (row.status === "UNMAPPED") unmappedRevenue += sum
  }
  const mappedRevenue = costedRevenue + missingCostRevenue
  const totalSalesRevenue = mappedRevenue + unmappedRevenue
  const coveragePct = totalSalesRevenue > 0 ? mappedRevenue / totalSalesRevenue : null

  const conversionGapCount = skuMatches.filter((m) => {
    if (m.conversionFactor !== 1) return false
    const from = canonicalizeUnit(m.fromUnit) ?? m.fromUnit.trim().toLowerCase()
    const to = canonicalizeUnit(m.toUnit) ?? m.toUnit.trim().toLowerCase()
    return from !== to
  }).length

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      windowStart,
      windowEnd,
      totalSalesRevenue,
      mappedRevenue,
      unmappedRevenue,
      coveragePct,
      conversionGapCount,
    },
  }
}
