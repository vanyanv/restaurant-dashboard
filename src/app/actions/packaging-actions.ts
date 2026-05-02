"use server"

import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getPackagingCostData } from "@/lib/packaging-costs"
import type { PackagingCostData } from "@/types/packaging"

export async function getPackagingCostReport(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<PackagingCostData | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if (!hasOwnerAccess(session.user.role)) return null

  return getPackagingCostData({
    accountId: session.user.accountId,
    storeId: options?.storeId,
    days: options?.days,
    startDate: options?.startDate,
    endDate: options?.endDate,
  })
}
