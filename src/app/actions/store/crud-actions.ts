"use server"

import { revalidatePath } from "next/cache"
import {
  COMMISSION_RATE_INPUTS,
  parseRatePercent,
  percentToFraction,
  type CommissionRateField,
} from "@/lib/counter/commission-rate-input"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { z } from "zod"
import { invalidateOwnerStoreCache } from "@/lib/chat/owner-scope"
import { cache } from "react"
import { bustTags } from "@/lib/cache/cached"

const createStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
})

const updateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
  fixedMonthlyLabor: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyRent: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyTowels: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyCleaning: z.number().min(0).max(1_000_000).nullable().optional(),
  // Delivery rates — required columns, so a blank leaves them unchanged.
  uberCommissionRate: z.number().min(0).max(1).optional(),
  doordashCommissionRate: z.number().min(0).max(1).optional(),
  // Nullable: a blank CLEARS the rate, which the P&L reads as "not known"
  // and flags rather than charging 0.
  uberPickupCommissionRate: z.number().min(0).max(1).nullable().optional(),
  doordashPickupCommissionRate: z.number().min(0).max(1).nullable().optional(),
  grubhubCommissionRate: z.number().min(0).max(1).nullable().optional(),
  lifecycleStage: z.enum(["pre_open", "warming_up", "ready"]).optional(),
})

export async function createStore(formData: FormData) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (!hasOwnerAccess(session.user.role)) {
      return { error: "Only owners can create stores" }
    }

    const validatedData = createStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
    })

    const store = await prisma.store.create({
      data: {
        ...validatedData,
        ownerId: session.user.id,
        accountId: session.user.accountId,
        isActive: true,
      },
    })

    invalidateOwnerStoreCache(session.user.accountId)
    revalidatePath("/dashboard")
    return { success: true, store }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("Create store error:", error)
    return { error: "Failed to create store" }
  }
}

/**
 * `getStores`' body, `cache()`d so a request pays for it once.
 *
 * Measured on `/dashboard/pnl` with the Prisma query log: this ran THREE
 * times in a single render, each time a whole-row `Store` scan with the
 * identical `accountId = $1 AND isActive = $2` predicate — the page's loaders
 * each call `getStores()` independently and none of them knew the others had.
 *
 * NOT EXPORTED, and not moved to `@/lib/account-stores` beside its narrow
 * sibling. Two separate constraints pin it here:
 *
 *   1. This is a `"use server"` module, where every EXPORT must be an async
 *      function. `cache()` returns a plain function, so exporting this
 *      directly would break the directive's contract. A module-local const is
 *      untouched by that rule, and `getStores` below stays the async export
 *      its twenty-three call sites import by name.
 *   2. It resolves a session, so it must not sit in `@/lib/account-stores` —
 *      that module is imported by `loadStripTargets` and `loadChannelMix`,
 *      both of which document that they must not pull `@/lib/auth` in at
 *      module load. See the note in that file.
 *
 * Whole rows and `createdAt desc` are both unchanged and both load-bearing:
 * `(editorial)/components/sections/ratings-section.tsx` sorts around that
 * ordering by name, and the callers may read any column.
 */
const getStoresCached = cache(async () => {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  // The rows come from `@/lib/account-stores`, which is the ONE store query a
  // request makes; the predicate and the ordering below are still this
  // function's own. See that module — four separately-`cache()`d helpers each
  // ran their own `store.findMany` for the same three rows, so every page paid
  // between one and six round trips for the same fact.
  const rows = await getAccountStoreRows(session.user.accountId)
  return rows
    .filter((s) => s.isActive)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
})

export async function getStores() {
  try {
    return await getStoresCached()
  } catch (error) {
    console.error("Get stores error:", error)
    return []
  }
}

export async function getStoreById(storeId: string) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return null
    }

    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        accountId: session.user.accountId,
      },
    })

    return store
  } catch (error) {
    console.error("Get store by ID error:", error)
    return null
  }
}

export async function updateStore(storeId: string, formData: FormData) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (!hasOwnerAccess(session.user.role)) {
      return { error: "Only owners can update stores" }
    }

    const parseOptionalNumber = (v: FormDataEntryValue | null): number | null | undefined => {
      if (v == null) return undefined
      const s = String(v).trim()
      if (s === "") return null
      const n = Number(s)
      return Number.isFinite(n) ? n : undefined
    }

    // Commission rates arrive as PERCENTS (25 = 25%) — one unit, parsed by
    // the one parser the form also validates with. Absent = unchanged;
    // blank clears an optional rate; anything else that is not 0..100 is an
    // error the owner sees, never silently dropped or rescaled.
    const rates: Partial<Record<CommissionRateField, number | null>> = {}
    for (const r of COMMISSION_RATE_INPUTS) {
      const v = formData.get(r.field)
      if (v == null) continue
      const parsed = parseRatePercent(String(v), r.label, { required: r.required })
      if (!parsed.ok) return { error: parsed.error }
      rates[r.field] = parsed.value === null ? null : percentToFraction(parsed.value)
    }
    const stage = formData.get("lifecycleStage")

    const validatedData = updateStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
      isActive: formData.get("isActive") === "true",
      fixedMonthlyLabor: parseOptionalNumber(formData.get("fixedMonthlyLabor")),
      fixedMonthlyRent: parseOptionalNumber(formData.get("fixedMonthlyRent")),
      fixedMonthlyTowels: parseOptionalNumber(formData.get("fixedMonthlyTowels")),
      fixedMonthlyCleaning: parseOptionalNumber(formData.get("fixedMonthlyCleaning")),
      ...rates,
      lifecycleStage: stage == null || String(stage) === "" ? undefined : String(stage),
    })

    const existingStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        accountId: session.user.accountId,
      },
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: validatedData,
    })

    invalidateOwnerStoreCache(session.user.accountId)
    revalidatePath("/dashboard/stores")
    revalidatePath(`/dashboard/stores/${storeId}`)
    // Commission rates price every P&L range, so a rate edit must not wait out
    // the rollup's 600s cache. Fire-and-forget, as the fixed-expense edits do.
    void bustTags(["pnl"])
    return { success: true, store: updatedStore }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("Update store error:", error)
    return { error: "Failed to update store" }
  }
}

export async function deleteStore(storeId: string) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (!hasOwnerAccess(session.user.role)) {
      return { error: "Only owners can delete stores" }
    }

    const existingStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        accountId: session.user.accountId,
      },
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: false },
    })

    invalidateOwnerStoreCache(session.user.accountId)
    revalidatePath("/dashboard/stores")
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Delete store error:", error)
    return { error: "Failed to delete store" }
  }
}
