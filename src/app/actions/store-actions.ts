"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

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
})

export async function createStore(formData: FormData) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
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
        isActive: true,
      },
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      }
    })

    revalidatePath("/dashboard")
    return { success: true, store }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
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
      where: session.user.role === "OWNER" 
        ? { ownerId: session.user.id }
        : {
            managers: {
              some: {
                managerId: session.user.id,
                isActive: true
              }
            }
          },
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return stores
  } catch (error) {
    console.error("Get stores error:", error)
    return []
  }
}

export async function getStoreAnalytics() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    const stores = await getStores()
    
    if (stores.length === 0) {
      return {
        todayReports: 0,
        totalReports: 0,
        totalRevenue: 0,
        averageTips: 0,
        avgPrepCompletion: 0,
        trends: {
          revenueGrowth: 0,
          currentWeekRevenue: 0,
          previousWeekRevenue: 0
        },
        storeCount: 0
      }
    }

    const storeIds = stores.map(s => s.id)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Get today's reports
    const todayReports = await prisma.dailyReport.count({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: today,
        }
      }
    })

    // Get last 30 days of reports
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
    const reports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: thirtyDaysAgo,
        }
      }
    })

    const totalReports = reports.length
    const totalRevenue = reports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const totalTips = reports.reduce((sum, r) => sum + r.tipCount, 0)
    const averageTips = totalReports > 0 ? totalTips / totalReports : 0
    
    const prepCompletions = reports.map(r => (r.morningPrepCompleted + r.eveningPrepCompleted) / 2)
    const avgPrepCompletion = prepCompletions.length > 0 
      ? Math.round(prepCompletions.reduce((sum, p) => sum + p, 0) / prepCompletions.length)
      : 0

    // Calculate week-over-week growth
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const currentWeekReports = reports.filter(r => r.date >= sevenDaysAgo)
    const previousWeekReports = reports.filter(r => 
      r.date >= fourteenDaysAgo && r.date < sevenDaysAgo
    )

    const currentWeekRevenue = currentWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const previousWeekRevenue = previousWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    
    const revenueGrowth = previousWeekRevenue > 0 
      ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100 
      : 0

    return {
      todayReports,
      totalReports,
      totalRevenue,
      averageTips,
      avgPrepCompletion,
      trends: {
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        currentWeekRevenue,
        previousWeekRevenue
      },
      storeCount: stores.length
    }
  } catch (error) {
    console.error("Get analytics error:", error)
    return null
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
        AND: session.user.role === "OWNER" 
          ? { ownerId: session.user.id }
          : {
              managers: {
                some: {
                  managerId: session.user.id,
                  isActive: true
                }
              }
            }
      },
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        },
        managers: {
          where: { isActive: true },
          include: {
            manager: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          }
        }
      }
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

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can update stores" }
    }

    const validatedData = updateStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
      isActive: formData.get("isActive") === "true",
    })

    // Verify store exists and user owns it
    const existingStore = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: validatedData,
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      }
    })

    revalidatePath("/dashboard/stores")
    revalidatePath(`/dashboard/stores/${storeId}`)
    return { success: true, store: updatedStore }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.errors[0].message }
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

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can delete stores" }
    }

    // Verify store exists and user owns it
    const existingStore = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      },
      include: {
        _count: {
          select: {
            reports: true,
            managers: true,
          }
        }
      }
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    // Soft delete - set as inactive instead of hard delete
    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: false }
    })

    // Deactivate all manager assignments
    await prisma.storeManager.updateMany({
      where: { storeId: storeId },
      data: { isActive: false }
    })

    revalidatePath("/dashboard/stores")
    return { success: true }
  } catch (error) {
    console.error("Delete store error:", error)
    return { error: "Failed to delete store" }
  }
}

export async function toggleStoreStatus(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can change store status" }
    }

    // Get current store status
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return { error: "Store not found or access denied" }
    }

    // Toggle status
    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: { isActive: !store.isActive }
    })

    revalidatePath("/dashboard/stores")
    revalidatePath(`/dashboard/stores/${storeId}`)
    return { success: true, store: updatedStore }
  } catch (error) {
    console.error("Toggle store status error:", error)
    return { error: "Failed to update store status" }
  }
}