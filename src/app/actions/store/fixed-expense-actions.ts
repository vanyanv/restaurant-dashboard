"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { invalidateOwnerStoreCache } from "@/lib/chat/owner-scope"
import { bustTags } from "@/lib/cache/cached"
import { ExpenseFrequency } from "@/generated/prisma/client"

export type StoreFixedExpenseDTO = {
  id: string
  label: string
  amount: number
  frequency: ExpenseFrequency
  sortOrder: number
}

const frequencySchema = z.nativeEnum(ExpenseFrequency)

const createSchema = z.object({
  storeId: z.string().min(1),
  label: z.string().trim().min(1, "Label is required").max(80),
  amount: z.number().min(0).max(1_000_000),
  frequency: frequencySchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Label is required").max(80).optional(),
  amount: z.number().min(0).max(1_000_000).optional(),
  frequency: frequencySchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
})

/** Revalidate every surface that renders P&L fixed costs and bust the
 *  Redis-cached all-stores P&L (tagged "pnl", 600s TTL). */
function revalidateAfterExpenseChange(accountId: string, storeId: string) {
  invalidateOwnerStoreCache(accountId)
  revalidatePath("/dashboard/pnl")
  revalidatePath(`/dashboard/pnl/${storeId}`)
  revalidatePath("/dashboard/stores")
  revalidatePath("/dashboard")
  // Fire-and-forget; cache failures never surface to the caller.
  void bustTags(["pnl"])
}

export async function createStoreFixedExpense(
  input: z.input<typeof createSchema>
): Promise<{ expense: StoreFixedExpenseDTO } | { error: string }> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (!hasOwnerAccess(session.user.role))
      return { error: "Only owners can edit fixed expenses" }

    const data = createSchema.parse(input)

    const store = await prisma.store.findFirst({
      where: { id: data.storeId, accountId: session.user.accountId },
      select: { id: true },
    })
    if (!store) return { error: "Store not found or access denied" }

    const created = await prisma.storeFixedExpense.create({
      data: {
        storeId: store.id,
        label: data.label,
        amount: data.amount,
        frequency: data.frequency,
        sortOrder: data.sortOrder ?? 0,
      },
      select: {
        id: true,
        label: true,
        amount: true,
        frequency: true,
        sortOrder: true,
      },
    })

    revalidateAfterExpenseChange(session.user.accountId, store.id)
    return { expense: created }
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0].message }
    console.error("createStoreFixedExpense error:", error)
    return { error: "Failed to create fixed expense" }
  }
}

export async function updateStoreFixedExpense(
  input: z.input<typeof updateSchema>
): Promise<{ expense: StoreFixedExpenseDTO } | { error: string }> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (!hasOwnerAccess(session.user.role))
      return { error: "Only owners can edit fixed expenses" }

    const { id, ...rest } = updateSchema.parse(input)

    // Re-verify the expense belongs to a store in the caller's account.
    const existing = await prisma.storeFixedExpense.findFirst({
      where: { id, store: { accountId: session.user.accountId } },
      select: { id: true, storeId: true },
    })
    if (!existing) return { error: "Fixed expense not found or access denied" }

    const updated = await prisma.storeFixedExpense.update({
      where: { id },
      data: rest,
      select: {
        id: true,
        label: true,
        amount: true,
        frequency: true,
        sortOrder: true,
      },
    })

    revalidateAfterExpenseChange(session.user.accountId, existing.storeId)
    return { expense: updated }
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0].message }
    console.error("updateStoreFixedExpense error:", error)
    return { error: "Failed to update fixed expense" }
  }
}

export async function deleteStoreFixedExpense(
  input: { id: string }
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (!hasOwnerAccess(session.user.role))
      return { error: "Only owners can edit fixed expenses" }

    const existing = await prisma.storeFixedExpense.findFirst({
      where: { id: input.id, store: { accountId: session.user.accountId } },
      select: { id: true, storeId: true },
    })
    if (!existing) return { error: "Fixed expense not found or access denied" }

    await prisma.storeFixedExpense.delete({ where: { id: existing.id } })

    revalidateAfterExpenseChange(session.user.accountId, existing.storeId)
    return { success: true }
  } catch (error) {
    console.error("deleteStoreFixedExpense error:", error)
    return { error: "Failed to delete fixed expense" }
  }
}
