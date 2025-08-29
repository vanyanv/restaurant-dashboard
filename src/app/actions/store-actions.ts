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
      where: session.user.role === "OWNER" 
        ? { 
            ownerId: session.user.id,
            isActive: true
          }
        : {
            isActive: true,
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
    revalidatePath("/dashboard")
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

export async function getRecentReports(storeId?: string, limit: number = 15) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

    const whereClause = session.user.role === "OWNER"
      ? {
          store: { ownerId: session.user.id },
          ...(storeId ? { storeId } : {})
        }
      : {
          managerId: session.user.id,
          ...(storeId ? { storeId } : {})
        }

    const reports = await prisma.dailyReport.findMany({
      where: whereClause,
      include: {
        store: {
          select: {
            id: true,
            name: true
          }
        },
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    return reports
  } catch (error) {
    console.error("Get recent reports error:", error)
    return []
  }
}

export async function getStoreMetrics(storeId: string, days: number = 30) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    // Verify access to store
    const store = await getStoreById(storeId)
    if (!store) {
      return null
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    const reports = await prisma.dailyReport.findMany({
      where: {
        storeId,
        date: {
          gte: startDate,
        }
      },
      include: {
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { date: 'desc' }
    })

    // Calculate daily revenue trends
    const revenueByDate = reports.reduce((acc: Record<string, number>, report) => {
      const dateStr = report.date.toISOString().split('T')[0]
      acc[dateStr] = (acc[dateStr] || 0) + (report.totalSales || 0)
      return acc
    }, {})

    const revenueTrends = Object.entries(revenueByDate)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Calculate prep task completion rates
    const prepTasks = ['prepMeat', 'prepSauce', 'prepOnionsSliced', 'prepOnionsDiced', 'prepTomatoesSliced', 'prepLettuce'] as const
    const prepCompletion = prepTasks.map(task => ({
      task: task.replace('prep', '').replace(/([A-Z])/g, ' $1').trim(),
      completed: reports.filter(r => r[task]).length,
      total: reports.length,
      percentage: reports.length > 0 ? Math.round((reports.filter(r => r[task]).length / reports.length) * 100) : 0
    }))

    // Manager performance
    const managerStats = reports.reduce((acc: Record<string, any>, report) => {
      const managerId = report.managerId
      if (!acc[managerId]) {
        acc[managerId] = {
          name: report.manager.name,
          email: report.manager.email,
          reportsCount: 0,
          totalRevenue: 0,
          avgPrepCompletion: 0,
          prepScores: []
        }
      }
      acc[managerId].reportsCount++
      acc[managerId].totalRevenue += report.totalSales || 0
      const prepScore = (report.morningPrepCompleted + report.eveningPrepCompleted) / 2
      acc[managerId].prepScores.push(prepScore)
      return acc
    }, {})

    // Calculate average prep completion for each manager
    Object.values(managerStats).forEach((manager: any) => {
      manager.avgPrepCompletion = manager.prepScores.length > 0 
        ? Math.round(manager.prepScores.reduce((sum: number, score: number) => sum + score, 0) / manager.prepScores.length)
        : 0
      delete manager.prepScores // Remove temporary array
    })

    // Shift performance comparison
    const morningReports = reports.filter(r => r.shift === 'MORNING' || r.shift === 'BOTH')
    const eveningReports = reports.filter(r => r.shift === 'EVENING' || r.shift === 'BOTH')

    const shiftComparison = {
      morning: {
        count: morningReports.length,
        avgRevenue: morningReports.length > 0 ? morningReports.reduce((sum, r) => sum + (r.totalSales || 0), 0) / morningReports.length : 0,
        avgPrepCompletion: morningReports.length > 0 ? Math.round(morningReports.reduce((sum, r) => sum + r.morningPrepCompleted, 0) / morningReports.length) : 0
      },
      evening: {
        count: eveningReports.length,
        avgRevenue: eveningReports.length > 0 ? eveningReports.reduce((sum, r) => sum + (r.totalSales || 0), 0) / eveningReports.length : 0,
        avgPrepCompletion: eveningReports.length > 0 ? Math.round(eveningReports.reduce((sum, r) => sum + r.eveningPrepCompleted, 0) / eveningReports.length) : 0
      }
    }

    // Till variance analysis
    const tillVariances = reports.map(r => ({
      date: r.date.toISOString().split('T')[0],
      shift: r.shift,
      variance: r.endingAmount - r.startingAmount,
      manager: r.manager.name
    }))

    return {
      store,
      totalReports: reports.length,
      dateRange: { start: startDate, end: new Date() },
      revenueTrends,
      prepCompletion,
      managerStats: Object.values(managerStats),
      shiftComparison,
      tillVariances,
      summary: {
        totalRevenue: reports.reduce((sum, r) => sum + (r.totalSales || 0), 0),
        avgTips: reports.length > 0 ? reports.reduce((sum, r) => sum + (r.cashTips || 0), 0) / reports.length : 0,
        avgPrepCompletion: reports.length > 0 ? Math.round(reports.reduce((sum, r) => sum + ((r.morningPrepCompleted + r.eveningPrepCompleted) / 2), 0) / reports.length) : 0
      }
    }
  } catch (error) {
    console.error("Get store metrics error:", error)
    return null
  }
}

export async function getTodayReportStatus() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user || session.user.role !== "OWNER") {
      return []
    }

    const stores = await getStores()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayReports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: stores.map(s => s.id) },
        date: {
          gte: today,
        }
      },
      select: {
        storeId: true,
        shift: true,
        managerId: true,
        manager: {
          select: {
            name: true
          }
        }
      }
    })

    // Create status grid for each store
    const statusGrid = stores.map(store => {
      const storeReports = todayReports.filter(r => r.storeId === store.id)
      const morningReport = storeReports.find(r => r.shift === 'MORNING' || r.shift === 'BOTH')
      const eveningReport = storeReports.find(r => r.shift === 'EVENING' || r.shift === 'BOTH')

      return {
        storeId: store.id,
        storeName: store.name,
        morning: {
          submitted: !!morningReport,
          manager: morningReport?.manager.name || null
        },
        evening: {
          submitted: !!eveningReport,
          manager: eveningReport?.manager.name || null
        }
      }
    })

    return statusGrid
  } catch (error) {
    console.error("Get today report status error:", error)
    return []
  }
}

export async function getPerformanceAlerts() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

    const stores = await getStores()
    const alerts: any[] = []

    // Check for missing reports today
    const statusGrid = await getTodayReportStatus()
    statusGrid.forEach(store => {
      if (!store.morning.submitted) {
        alerts.push({
          type: 'missing_report',
          severity: 'warning',
          storeId: store.storeId,
          storeName: store.storeName,
          message: 'Missing morning report',
          shift: 'MORNING'
        })
      }
      if (!store.evening.submitted) {
        alerts.push({
          type: 'missing_report',
          severity: 'warning',
          storeId: store.storeId,
          storeName: store.storeName,
          message: 'Missing evening report',
          shift: 'EVENING'
        })
      }
    })

    // Check for low prep completion in recent reports
    const recentReports = await getRecentReports(undefined, 50)
    recentReports.forEach(report => {
      const avgPrep = (report.morningPrepCompleted + report.eveningPrepCompleted) / 2
      if (avgPrep < 70) {
        alerts.push({
          type: 'low_prep',
          severity: 'error',
          storeId: report.storeId,
          storeName: report.store.name,
          message: `Low prep completion: ${Math.round(avgPrep)}%`,
          manager: report.manager.name,
          date: report.date
        })
      }
    })

    return alerts.slice(0, 10) // Limit to 10 most recent alerts
  } catch (error) {
    console.error("Get performance alerts error:", error)
    return []
  }
}