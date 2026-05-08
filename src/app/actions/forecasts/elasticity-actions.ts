"use server"

// Per-item price elasticity, computed nightly by the ML pipeline.
//
// Elasticity coefficient = ∂log(qty) / ∂log(price). Read it like:
//   −1.0  : a 10% price hike loses 10% of volume      (unit elastic)
//   −2.0  : 10% price hike loses 20% of volume        (very elastic)
//   −0.3  : 10% price hike loses 3% of volume         (inelastic — pricing power)
//    0    : no measurable response                    (noise / static price)
//   +X    : quantity increased after a price hike — almost always confounding,
//           treat as "no_signal" in the UI.

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

export type ElasticityConfidence = "low" | "medium" | "high" | "no_signal"

export interface MenuItemElasticityRow {
  otterItemSkuId: string
  elasticity: number
  intercept: number
  fitR2: number
  sampleSize: number
  pricePointCount: number
  meanPrice: number
  meanQty: number
  confidence: ElasticityConfidence
  /** Predicted % volume change for a 10% price hike, in the user's domain. */
  pctVolumeChangeAt10PctHike: number
  computedAt: Date
}

export interface MenuItemElasticityData {
  storeId: string
  storeName: string
  rows: MenuItemElasticityRow[]
}

export type GetMenuItemElasticityResult =
  | { ok: true; data: MenuItemElasticityData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuItemElasticity(input: {
  storeId: string
}): Promise<GetMenuItemElasticityResult | null> {
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

  const rows = await prisma.menuItemElasticity.findMany({
    where: { storeId: input.storeId },
    orderBy: { elasticity: "asc" }, // most-elastic first (most negative)
    select: {
      otterItemSkuId: true,
      elasticity: true,
      intercept: true,
      fitR2: true,
      sampleSize: true,
      pricePointCount: true,
      meanPrice: true,
      meanQty: true,
      computedAt: true,
    },
  })

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      rows: rows.map((r) => ({
        otterItemSkuId: r.otterItemSkuId,
        elasticity: r.elasticity,
        intercept: r.intercept,
        fitR2: r.fitR2,
        sampleSize: r.sampleSize,
        pricePointCount: r.pricePointCount,
        meanPrice: r.meanPrice,
        meanQty: r.meanQty,
        computedAt: r.computedAt,
        confidence: classify(r),
        // Apply the elasticity to a hypothetical 10% price hike.
        // %ΔQ ≈ elasticity × %ΔP. Express as positive volume LOSS.
        pctVolumeChangeAt10PctHike: 0.1 * r.elasticity,
      })),
    },
  }
}

function classify(r: {
  elasticity: number
  fitR2: number
  pricePointCount: number
}): ElasticityConfidence {
  if (r.pricePointCount < 2 || r.elasticity > 0) return "no_signal"
  if (r.fitR2 < 0.1) return "low"
  if (r.fitR2 < 0.4) return "medium"
  return "high"
}
