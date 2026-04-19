import { prisma } from "@/lib/prisma"

/**
 * Delete DailyCogsItem rows whose inputs just changed. Refill happens on the
 * next Otter sync (via `refreshStaleDailyCogs`) or a manual recompute — this
 * function never computes, only invalidates.
 *
 * All mutation paths that touch COGS inputs (invoices, recipes, mappings,
 * aliases, canonical ingredients) should call this after their write.
 * Deletion is cheap and idempotent, so it's fine to over-invalidate when
 * the exact scope is ambiguous.
 */
export type InvalidateScope =
  | { kind: "store-from-date"; storeId: string; fromDate: Date }
  | { kind: "store-item"; storeId: string; itemName: string }
  | { kind: "store-full"; storeId: string }
  | { kind: "owner-recipe"; ownerId: string; recipeId: string; itemName: string }
  | { kind: "owner-full"; ownerId: string }

export async function invalidateDailyCogs(scope: InvalidateScope): Promise<number> {
  switch (scope.kind) {
    case "store-from-date": {
      const { count } = await prisma.dailyCogsItem.deleteMany({
        where: { storeId: scope.storeId, date: { gte: startOfDayUTC(scope.fromDate) } },
      })
      return count
    }
    case "store-item": {
      const { count } = await prisma.dailyCogsItem.deleteMany({
        where: { storeId: scope.storeId, itemName: scope.itemName },
      })
      return count
    }
    case "store-full": {
      const { count } = await prisma.dailyCogsItem.deleteMany({
        where: { storeId: scope.storeId },
      })
      return count
    }
    case "owner-recipe": {
      const stores = await prisma.store.findMany({
        where: { ownerId: scope.ownerId },
        select: { id: true },
      })
      if (stores.length === 0) return 0
      const storeIds = stores.map((s) => s.id)
      const { count } = await prisma.dailyCogsItem.deleteMany({
        where: {
          storeId: { in: storeIds },
          OR: [{ recipeId: scope.recipeId }, { itemName: scope.itemName }],
        },
      })
      return count
    }
    case "owner-full": {
      const stores = await prisma.store.findMany({
        where: { ownerId: scope.ownerId },
        select: { id: true },
      })
      if (stores.length === 0) return 0
      const { count } = await prisma.dailyCogsItem.deleteMany({
        where: { storeId: { in: stores.map((s) => s.id) } },
      })
      return count
    }
  }
}

function startOfDayUTC(d: Date): Date {
  const n = new Date(d)
  n.setUTCHours(0, 0, 0, 0)
  return n
}
