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

export interface CountDetailLine {
  ingredientId: string
  ingredientName: string
  category: string
  recipeUnit: string | null
  actualQty: number
  estimatedQty: number | null
  /** estimatedQty − actualQty. Positive = unexplained waste; negative = gain. Null when no estimate. */
  deltaQty: number | null
  /** deltaQty × costPerRecipeUnit. Null when either estimate or cost is missing. */
  deltaCost: number | null
  costPerRecipeUnit: number | null
  note: string | null
}

export interface CountDetailData {
  countId: string
  storeId: string
  storeName: string
  status: string
  countedAt: Date
  completedAt: Date | null
  note: string | null
  lines: CountDetailLine[]
  /** Σ deltaQty across lines with an estimate. */
  totalDeltaQty: number
  /** Σ deltaCost across lines with an estimate AND a cost. */
  totalDeltaCost: number
  /** Number of lines that contributed to the totals. */
  linesWithDelta: number
}

export type GetCountDetailResult =
  | { ok: true; data: CountDetailData }
  | { ok: false; error: "count_not_found" }
  | { ok: false; error: "count_not_in_account" }

export async function getCountDetail(input: {
  stockCountId: string
}): Promise<GetCountDetailResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const count = await prisma.stockCount.findUnique({
    where: { id: input.stockCountId },
    select: {
      id: true,
      storeId: true,
      status: true,
      countedAt: true,
      completedAt: true,
      note: true,
      store: { select: { accountId: true, name: true } },
    },
  })
  if (!count) return { ok: false, error: "count_not_found" }
  if (count.store.accountId !== user.accountId) {
    return { ok: false, error: "count_not_in_account" }
  }

  const [lines, ingredients] = await Promise.all([
    prisma.stockCountLine.findMany({
      where: { stockCountId: input.stockCountId },
      select: {
        canonicalIngredientId: true,
        qtyInRecipeUnit: true,
        nativeQty: true,
        nativeUnit: true,
        estimatedQtyAtCount: true,
        calibrationFactorAtCount: true,
        note: true,
      },
    }),
    prisma.canonicalIngredient.findMany({
      where: { accountId: user.accountId },
      select: {
        id: true,
        name: true,
        category: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
      },
    }),
  ])

  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]))

  const detailLines: CountDetailLine[] = []
  let totalDeltaQty = 0
  let totalDeltaCost = 0
  let linesWithDelta = 0

  for (const line of lines) {
    const ing = ingredientMap.get(line.canonicalIngredientId)
    if (!ing) continue
    const deltaQty =
      line.estimatedQtyAtCount != null
        ? line.estimatedQtyAtCount - line.qtyInRecipeUnit
        : null
    const deltaCost =
      deltaQty != null && ing.costPerRecipeUnit != null
        ? deltaQty * ing.costPerRecipeUnit
        : null
    if (deltaQty != null) {
      totalDeltaQty += deltaQty
      linesWithDelta++
    }
    if (deltaCost != null) totalDeltaCost += deltaCost

    detailLines.push({
      ingredientId: ing.id,
      ingredientName: ing.name,
      category: ing.category ?? "Uncategorized",
      recipeUnit: ing.recipeUnit,
      actualQty: line.qtyInRecipeUnit,
      estimatedQty: line.estimatedQtyAtCount,
      deltaQty,
      deltaCost,
      costPerRecipeUnit: ing.costPerRecipeUnit,
      note: line.note,
    })
  }

  detailLines.sort((a, b) => {
    const ad = Math.abs(a.deltaCost ?? a.deltaQty ?? 0)
    const bd = Math.abs(b.deltaCost ?? b.deltaQty ?? 0)
    return bd - ad
  })

  return {
    ok: true,
    data: {
      countId: count.id,
      storeId: count.storeId,
      storeName: count.store.name,
      status: count.status,
      countedAt: count.countedAt,
      completedAt: count.completedAt,
      note: count.note,
      lines: detailLines,
      totalDeltaQty,
      totalDeltaCost,
      linesWithDelta,
    },
  }
}
