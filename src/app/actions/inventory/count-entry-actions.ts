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

async function requireSession(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  return session?.user ?? null
}

async function loadStoreIdsForAccount(accountId: string): Promise<string[]> {
  const stores = await prisma.store.findMany({
    where: { accountId },
    select: { id: true },
  })
  return stores.map((s) => s.id)
}

// ---------------------------------------------------------------------------
// startOrResumeStockCount
// ---------------------------------------------------------------------------

export type StartOrResumeStockCountResult =
  | { ok: true; stockCountId: string; resumed: boolean }
  | { ok: false; error: "store_not_in_account" }

export async function startOrResumeStockCount(input: {
  storeId: string
}): Promise<StartOrResumeStockCountResult | null> {
  const user = await requireSession()
  if (!user) return null

  const storeIds = await loadStoreIdsForAccount(user.accountId)
  if (!storeIds.includes(input.storeId)) {
    return { ok: false, error: "store_not_in_account" }
  }

  const existing = await prisma.stockCount.findFirst({
    where: { storeId: input.storeId, status: "IN_PROGRESS" },
    select: { id: true },
  })
  if (existing) {
    return { ok: true, stockCountId: existing.id, resumed: true }
  }

  const created = await prisma.stockCount.create({
    data: {
      storeId: input.storeId,
      countedByUserId: user.id,
      countedAt: new Date(),
      status: "IN_PROGRESS",
    },
    select: { id: true },
  })
  return { ok: true, stockCountId: created.id, resumed: false }
}

// ---------------------------------------------------------------------------
// getCountEntryData
// ---------------------------------------------------------------------------

export interface CountEntryIngredient {
  id: string
  name: string
  category: string
  recipeUnit: string | null
  existingLine: {
    nativeQty: number
    nativeUnit: string
    qtyInRecipeUnit: number
    note: string | null
  } | null
}

export interface CountEntryHeader {
  id: string
  storeId: string
  storeName: string
  status: string
  countedAt: Date
}

export type GetCountEntryDataResult =
  | { ok: true; count: CountEntryHeader; ingredients: CountEntryIngredient[] }
  | { ok: false; error: "count_not_found" }
  | { ok: false; error: "count_not_in_account" }

export async function getCountEntryData(input: {
  stockCountId: string
}): Promise<GetCountEntryDataResult | null> {
  const user = await requireSession()
  if (!user) return null

  const count = await prisma.stockCount.findUnique({
    where: { id: input.stockCountId },
    select: {
      id: true,
      storeId: true,
      status: true,
      countedAt: true,
      store: { select: { accountId: true, name: true } },
    },
  })
  if (!count) return { ok: false, error: "count_not_found" }
  if (count.store.accountId !== user.accountId) {
    return { ok: false, error: "count_not_in_account" }
  }

  const [ingredients, lines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId: user.accountId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, recipeUnit: true },
    }),
    prisma.stockCountLine.findMany({
      where: { stockCountId: input.stockCountId },
      select: {
        canonicalIngredientId: true,
        nativeQty: true,
        nativeUnit: true,
        qtyInRecipeUnit: true,
        note: true,
      },
    }),
  ])

  const linesByIngredient = new Map(
    lines.map((l) => [l.canonicalIngredientId, l])
  )

  const merged: CountEntryIngredient[] = ingredients.map((i) => {
    const line = linesByIngredient.get(i.id)
    return {
      id: i.id,
      name: i.name,
      category: i.category ?? "Uncategorized",
      recipeUnit: i.recipeUnit,
      existingLine: line
        ? {
            nativeQty: line.nativeQty ?? 0,
            nativeUnit: line.nativeUnit ?? "",
            qtyInRecipeUnit: line.qtyInRecipeUnit,
            note: line.note,
          }
        : null,
    }
  })

  return {
    ok: true,
    count: {
      id: count.id,
      storeId: count.storeId,
      storeName: count.store.name,
      status: count.status,
      countedAt: count.countedAt,
    },
    ingredients: merged,
  }
}
