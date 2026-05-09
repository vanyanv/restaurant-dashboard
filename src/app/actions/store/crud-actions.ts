"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { invalidateOwnerStoreCache } from "@/lib/chat/owner-scope"

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
  uberCommissionRate: z.number().min(0).max(1).optional(),
  doordashCommissionRate: z.number().min(0).max(1).optional(),
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

export async function getStores() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return []
    }

    const stores = await prisma.store.findMany({
      where: {
        accountId: session.user.accountId,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    })

    return stores
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

    const parseRate = (v: FormDataEntryValue | null): number | undefined => {
      if (v == null) return undefined
      const s = String(v).trim()
      if (s === "") return undefined
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) return undefined
      return n > 1 ? n / 100 : n
    }

    const validatedData = updateStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
      isActive: formData.get("isActive") === "true",
      fixedMonthlyLabor: parseOptionalNumber(formData.get("fixedMonthlyLabor")),
      fixedMonthlyRent: parseOptionalNumber(formData.get("fixedMonthlyRent")),
      fixedMonthlyTowels: parseOptionalNumber(formData.get("fixedMonthlyTowels")),
      fixedMonthlyCleaning: parseOptionalNumber(formData.get("fixedMonthlyCleaning")),
      uberCommissionRate: parseRate(formData.get("uberCommissionRate")),
      doordashCommissionRate: parseRate(formData.get("doordashCommissionRate")),
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
