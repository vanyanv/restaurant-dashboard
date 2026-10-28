"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { z } from "zod"
import type { Prisma } from "@/generated/prisma/client"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { requireOwnerStore } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
} from "@/lib/inventory/store-inventory-context"
import {
  COUNT_AREAS,
  WASTE_REASONS,
  WASTE_REASON_IDS,
  defaultLayers,
  describeShelf,
  guessArea,
  layersFor,
  resolveLayers,
  shelfTotal,
  valuesFit,
} from "@/lib/counter/count-layers"

/**
 * The owner's write path for the weekly count, the waste log and the count
 * setup. Every action checks the session, owner access and the account: a
 * store goes through `requireOwnerStore`, everything else is matched on
 * `accountId`, the tenancy boundary.
 */

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string }

/** Counts left open this long are dropped rather than resumed. */
const STALE_OPEN_DAYS = 7
const DAY_MS = 86_400_000

async function requireOwner(): Promise<{ id: string; accountId: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")
  return { id: session.user.id, accountId: session.user.accountId }
}

function fail(err: unknown): ActionResult {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form" }
  if (err instanceof Error && ["Unauthorized", "Forbidden", "Store not found"].includes(err.message)) {
    return { ok: false, error: err.message === "Store not found" ? "That store isn't on your account" : "You need to be signed in as an owner" }
  }
  console.error("[count action]", err)
  return { ok: false, error: "That didn't save. Try again." }
}

function revalidateCount() {
  revalidatePath("/dashboard/count", "layout")
  revalidatePath("/m/count", "layout")
}

// ---------------------------------------------------------------------------
// The count
// ---------------------------------------------------------------------------

/** Opens this week's count for a store, or picks up the one already open. */
export async function startCount(storeId: string): Promise<ActionResult> {
  try {
    const store = await requireOwnerStore(storeId)
    const owner = await requireOwner()
    const cutoff = new Date(Date.now() - STALE_OPEN_DAYS * DAY_MS)
    const open = await prisma.stockCount.findFirst({
      where: { storeId: store.id, status: "IN_PROGRESS", startedAt: { gte: cutoff } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    })
    if (open) return { ok: true, id: open.id }
    // A count opened weeks ago and never finished is not this week's count.
    await prisma.stockCount.updateMany({
      where: { storeId: store.id, status: "IN_PROGRESS", startedAt: { lt: cutoff } },
      data: { status: "ABANDONED" },
    })
    const created = await prisma.stockCount.create({
      data: { storeId: store.id, countedByUserId: owner.id, countedAt: new Date(), status: "IN_PROGRESS" },
      select: { id: true },
    })
    revalidateCount()
    return { ok: true, id: created.id }
  } catch (err) {
    return fail(err)
  }
}

const SaveItemInput = z.object({
  countId: z.string().min(1),
  countItemId: z.string().min(1),
  values: z.array(z.number().min(0, "Counts can't be negative").max(1_000_000)).max(4),
})

/**
 * Saves one stop of the walk. The same ingredient can be counted at two
 * stops (beef in the walk-in, pressed patties on the line), so the line's
 * total is every stop's shelf added together, each through its own layers.
 */
export async function saveCountItem(input: z.input<typeof SaveItemInput>): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const v = SaveItemInput.parse(input)
    const [count, item] = await Promise.all([
      prisma.stockCount.findFirst({
        where: { id: v.countId, store: { accountId: owner.accountId } },
        select: { id: true, storeId: true, status: true, startedAt: true },
      }),
      prisma.countItem.findFirst({
        where: { id: v.countItemId, accountId: owner.accountId },
        select: { id: true, canonicalIngredientId: true, canonicalIngredient: { select: { name: true, recipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true } } },
      }),
    ])
    if (!count) return { ok: false, error: "That count isn't on your account" }
    if (count.status !== "IN_PROGRESS") return { ok: false, error: "This count is already finished" }
    if (!item) return { ok: false, error: "That item isn't on your count list" }
    const ing = item.canonicalIngredient
    if (!ing.recipeUnit) return { ok: false, error: `${ing.name} has no recipe unit yet` }

    const existing = await prisma.stockCountLine.findUnique({
      where: { stockCountId_canonicalIngredientId: { stockCountId: count.id, canonicalIngredientId: item.canonicalIngredientId } },
      select: { breakdown: true, estimatedQtyAtCount: true },
    })
    const breakdown: Record<string, number[]> = {}
    if (existing?.breakdown && typeof existing.breakdown === "object" && !Array.isArray(existing.breakdown)) {
      for (const [k, val] of Object.entries(existing.breakdown as Record<string, unknown>)) {
        if (Array.isArray(val)) breakdown[k] = val.map((n) => (typeof n === "number" ? n : 0))
      }
    }
    breakdown[item.id] = v.values

    // Every stop for this ingredient, with its current layers.
    const stops = await prisma.countItem.findMany({
      where: { accountId: owner.accountId, canonicalIngredientId: item.canonicalIngredientId, active: true, id: { in: Object.keys(breakdown) } },
      select: { id: true, layers: true },
    })
    // A stop removed in setup, or whose layers changed since it was counted,
    // drops out: its old numbers would add to the wrong total.
    const kept: Record<string, number[]> = {}
    let total = 0
    const notes: string[] = []
    for (const s of stops) {
      const layers = layersFor(s.layers, ing.recipeUnit)
      const vals = breakdown[s.id]
      if (!valuesFit(layers, vals)) continue
      kept[s.id] = vals
      total += shelfTotal(layers, vals)
      notes.push(describeShelf(layers, vals))
    }
    if (!kept[item.id]) return { ok: false, error: "This item's setup changed. Reload and count it again" }

    // The model's expectation, only once a finished count anchors it — before
    // that it integrates from the first invoice and teaches the model nothing.
    let estimate: number | null = existing?.estimatedQtyAtCount ?? null
    if (estimate === null) {
      const ctx = await loadStoreInventoryContext({ storeId: count.storeId, accountId: owner.accountId, asOf: count.startedAt })
      const r = runningOnHandFromContext(ctx, { id: item.canonicalIngredientId, name: ing.name, recipeUnit: ing.recipeUnit, caseUnit: ing.caseUnit, recipeUnitsPerCase: ing.recipeUnitsPerCase, innerPackUnit: ing.innerPackUnit, innerPacksPerCase: ing.innerPacksPerCase })
      if (r.baseAt && Number.isFinite(r.onHand)) estimate = r.onHand
    }

    const data = {
      qtyInRecipeUnit: total,
      nativeQty: total,
      nativeUnit: ing.recipeUnit,
      note: notes.join("; ").slice(0, 500),
      breakdown: kept as Prisma.InputJsonValue,
    }
    await prisma.stockCountLine.upsert({
      where: { stockCountId_canonicalIngredientId: { stockCountId: count.id, canonicalIngredientId: item.canonicalIngredientId } },
      create: { stockCountId: count.id, canonicalIngredientId: item.canonicalIngredientId, ...data, estimatedQtyAtCount: estimate },
      update: { ...data, ...(existing?.estimatedQtyAtCount == null && estimate !== null ? { estimatedQtyAtCount: estimate } : {}) },
    })
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

/** Closes the count. This is what makes it the starting point for next week. */
export async function finishCount(countId: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const count = await prisma.stockCount.findFirst({
      where: { id: countId, store: { accountId: owner.accountId } },
      select: { id: true, status: true, _count: { select: { lines: true } } },
    })
    if (!count) return { ok: false, error: "That count isn't on your account" }
    if (count.status !== "IN_PROGRESS") return { ok: false, error: "This count is already finished" }
    if (count._count.lines === 0) return { ok: false, error: "Count at least one item first" }
    // Calibration reads the previous COMPLETED count, so it runs before this
    // one becomes COMPLETED. Same order as `completeStockCount`.
    await applyCalibrationUpdatesForCount(count.id)
    // Guarded on status, so a double tap can't finish it twice.
    const done = await prisma.stockCount.updateMany({
      where: { id: count.id, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", completedAt: new Date(), countedAt: new Date() },
    })
    if (done.count === 0) return { ok: false, error: "This count is already finished" }
    revalidateCount()
    return { ok: true, id: count.id }
  } catch (err) {
    return fail(err)
  }
}

// ---------------------------------------------------------------------------
// Waste
// ---------------------------------------------------------------------------

const WasteInput = z.object({
  storeId: z.string().min(1),
  ingredientId: z.string().min(1),
  /** In the ingredient's recipe unit. */
  qty: z.number().positive("How much was thrown out?").max(100_000),
  reason: z.enum(WASTE_REASONS.map((r) => r.id) as [string, ...string[]], { message: "Pick a reason" }),
  note: z.string().trim().max(200).optional(),
})

export async function logWaste(input: z.input<typeof WasteInput>): Promise<ActionResult> {
  try {
    const v = WasteInput.parse(input)
    const store = await requireOwnerStore(v.storeId)
    const owner = await requireOwner()
    const ing = await prisma.canonicalIngredient.findFirst({
      where: { id: v.ingredientId, accountId: owner.accountId },
      select: { id: true },
    })
    if (!ing) return { ok: false, error: "That item isn't on your account" }
    const created = await prisma.inventoryAdjustment.create({
      data: {
        storeId: store.id,
        canonicalIngredientId: ing.id,
        qty: v.qty,
        reason: v.reason as "DROPPED" | "EXPIRY" | "BURNT" | "REMAKE" | "OTHER",
        note: v.note || null,
        occurredAt: new Date(),
        createdByUserId: owner.id,
      },
      select: { id: true },
    })
    revalidateCount()
    return { ok: true, id: created.id, message: "Saved" }
  } catch (err) {
    return fail(err)
  }
}

/** Takes back a waste entry logged by mistake (last 7 days only). */
export async function deleteWaste(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const row = await prisma.inventoryAdjustment.findFirst({
      where: { id, store: { accountId: owner.accountId }, reason: { in: WASTE_REASON_IDS }, occurredAt: { gte: new Date(Date.now() - 7 * DAY_MS) } },
      select: { id: true },
    })
    if (!row) return { ok: false, error: "That entry can't be removed any more" }
    await prisma.inventoryAdjustment.delete({ where: { id: row.id } })
    revalidateCount()
    return { ok: true, message: "Removed" }
  } catch (err) {
    return fail(err)
  }
}

// ---------------------------------------------------------------------------
// Setup: what is on the count, where, and how it is counted
// ---------------------------------------------------------------------------

const AREA = z.enum(COUNT_AREAS.map((a) => a.id) as [string, ...string[]])

async function nextSort(accountId: string, area: string): Promise<number> {
  const last = await prisma.countItem.findFirst({
    where: { accountId, area, active: true },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })
  return (last?.sortOrder ?? 0) + 10
}

export async function addCountItem(input: { ingredientId: string; area: string }): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const area = AREA.parse(input.area)
    const ing = await prisma.canonicalIngredient.findFirst({
      where: { id: input.ingredientId, accountId: owner.accountId },
      select: { id: true, name: true, recipeUnit: true },
    })
    if (!ing) return { ok: false, error: "That ingredient isn't on your account" }
    if (!ing.recipeUnit) return { ok: false, error: `${ing.name} needs a recipe unit first (Ingredients page)` }
    const sortOrder = await nextSort(owner.accountId, area)
    const row = await prisma.countItem.upsert({
      where: { accountId_canonicalIngredientId_area: { accountId: owner.accountId, canonicalIngredientId: ing.id, area } },
      create: { accountId: owner.accountId, canonicalIngredientId: ing.id, area, sortOrder, layers: defaultLayers(ing.recipeUnit) as unknown as Prisma.InputJsonValue },
      update: { active: true, sortOrder },
      select: { id: true },
    })
    revalidateCount()
    return { ok: true, id: row.id, message: `${ing.name} added` }
  } catch (err) {
    return fail(err)
  }
}

const LayersInput = z.object({
  id: z.string().min(1),
  area: AREA,
  layers: z
    .array(z.object({ label: z.string().trim().min(1, "Every layer needs a name").max(40), qty: z.number(), of: z.string().trim().min(1).max(40), quarters: z.boolean().optional() }))
    .min(1)
    .max(4),
})

export async function saveCountItemSetup(input: z.input<typeof LayersInput>): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const v = LayersInput.parse(input)
    const item = await prisma.countItem.findFirst({
      where: { id: v.id, accountId: owner.accountId },
      select: { id: true, area: true, canonicalIngredientId: true, canonicalIngredient: { select: { recipeUnit: true } } },
    })
    if (!item) return { ok: false, error: "That item isn't on your count list" }
    const unit = item.canonicalIngredient.recipeUnit
    if (!unit) return { ok: false, error: "This ingredient has no recipe unit yet" }
    const r = resolveLayers(v.layers, unit)
    if (!r.ok) return { ok: false, error: r.error }
    if (v.area !== item.area) {
      const clash = await prisma.countItem.findFirst({
        where: { accountId: owner.accountId, canonicalIngredientId: item.canonicalIngredientId, area: v.area, id: { not: item.id } },
        select: { id: true, active: true },
      })
      if (clash?.active) return { ok: false, error: "It's already counted in that area" }
      if (clash) await prisma.countItem.delete({ where: { id: clash.id } })
    }
    await prisma.countItem.update({
      where: { id: item.id },
      data: {
        layers: r.layers as unknown as Prisma.InputJsonValue,
        ...(v.area !== item.area ? { area: v.area, sortOrder: await nextSort(owner.accountId, v.area) } : {}),
      },
    })
    revalidateCount()
    return { ok: true, message: "Saved" }
  } catch (err) {
    return fail(err)
  }
}

/** Moves an item one place up or down the walk within its area. */
export async function moveCountItem(input: { id: string; dir: "up" | "down" }): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const item = await prisma.countItem.findFirst({
      where: { id: input.id, accountId: owner.accountId },
      select: { id: true, area: true },
    })
    if (!item) return { ok: false, error: "That item isn't on your count list" }
    const list = await prisma.countItem.findMany({
      where: { accountId: owner.accountId, area: item.area, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    })
    const i = list.findIndex((x) => x.id === item.id)
    const j = input.dir === "up" ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= list.length) return { ok: true }
    ;[list[i], list[j]] = [list[j], list[i]]
    await prisma.$transaction(list.map((x, k) => prisma.countItem.update({ where: { id: x.id }, data: { sortOrder: (k + 1) * 10 } })))
    revalidateCount()
    return { ok: true }
  } catch (err) {
    return fail(err)
  }
}

export async function removeCountItem(id: string): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const res = await prisma.countItem.updateMany({ where: { id, accountId: owner.accountId }, data: { active: false } })
    if (res.count === 0) return { ok: false, error: "That item isn't on your count list" }
    revalidateCount()
    return { ok: true, message: "Taken off the count" }
  } catch (err) {
    return fail(err)
  }
}

/**
 * First-time setup: puts the biggest spends of the last 60 days on the count,
 * each in the area its supplier category suggests, counted loose in its
 * recipe unit until the owner adds the case and pack layers.
 */
export async function addTopSpendItems(limit = 15): Promise<ActionResult> {
  try {
    const owner = await requireOwner()
    const since = new Date(Date.now() - 60 * DAY_MS)
    const spend = await prisma.invoiceLineItem.groupBy({
      by: ["canonicalIngredientId"],
      where: { canonicalIngredientId: { not: null }, invoice: { accountId: owner.accountId, invoiceDate: { gte: since } } },
      _sum: { extendedPrice: true },
      orderBy: { _sum: { extendedPrice: "desc" } },
      take: 60,
    })
    const ids = spend.flatMap((s) => (s.canonicalIngredientId ? [s.canonicalIngredientId] : []))
    const [ings, have] = await Promise.all([
      prisma.canonicalIngredient.findMany({
        where: { id: { in: ids }, accountId: owner.accountId, recipeUnit: { not: null }, recipeIngredients: { some: {} } },
        select: { id: true, recipeUnit: true, category: true },
      }),
      prisma.countItem.findMany({ where: { accountId: owner.accountId, active: true }, select: { canonicalIngredientId: true } }),
    ])
    const already = new Set(have.map((h) => h.canonicalIngredientId))
    const byId = new Map(ings.map((i) => [i.id, i]))
    const pick = ids.flatMap((id) => (byId.has(id) && !already.has(id) ? [byId.get(id)!] : [])).slice(0, Math.max(0, limit - already.size))
    if (pick.length === 0) return { ok: true, message: "Nothing new to add" }
    let order = 10
    for (const ing of pick) {
      const area = guessArea(ing.category)
      await prisma.countItem.upsert({
        where: { accountId_canonicalIngredientId_area: { accountId: owner.accountId, canonicalIngredientId: ing.id, area } },
        create: { accountId: owner.accountId, canonicalIngredientId: ing.id, area, sortOrder: order, layers: defaultLayers(ing.recipeUnit!) as unknown as Prisma.InputJsonValue },
        update: { active: true },
      })
      order += 10
    }
    revalidateCount()
    return { ok: true, message: `Added ${pick.length} items` }
  } catch (err) {
    return fail(err)
  }
}
