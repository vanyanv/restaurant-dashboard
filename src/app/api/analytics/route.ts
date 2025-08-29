import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { subDays, startOfDay, endOfDay, format } from "date-fns"

// Cache the response for 5 minutes
export const revalidate = 300

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')
    const days = parseInt(searchParams.get('days') || '30')

    // For owners, if storeId is 'all' or not provided, aggregate all their stores
    const isOwner = session.user.role === "OWNER"
    const showAllStores = isOwner && (!storeId || storeId === 'all')

    let storeIds: string[] = []

    if (showAllStores) {
      // Get all stores owned by this user
      const ownedStores = await prisma.store.findMany({
        where: { ownerId: session.user.id },
        select: { id: true, name: true }
      })
      
      if (ownedStores.length === 0) {
        return NextResponse.json({ error: "No stores found" }, { status: 404 })
      }
      
      storeIds = ownedStores.map(s => s.id)
    } else {
      // Single store mode - verify user has access
      if (!storeId) {
        return NextResponse.json({ error: "Store ID is required" }, { status: 400 })
      }

      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          OR: [
            { ownerId: session.user.id },
            {
              managers: {
                some: {
                  managerId: session.user.id,
                  isActive: true
                }
              }
            }
          ]
        }
      })

      if (!store) {
        return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 })
      }
      
      storeIds = [storeId]
    }

    const endDate = new Date()
    const startDate = subDays(endDate, days)

    // Get all reports for the specified period
    const reports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: startOfDay(startDate),
          lte: endOfDay(endDate)
        }
      },
      include: {
        store: {
          select: { name: true }
        }
      },
      orderBy: { date: 'asc' }
    })

    // Get today's reports
    const today = new Date()
    const todayReports = await prisma.dailyReport.count({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: startOfDay(today),
          lte: endOfDay(today)
        }
      }
    })

    // Calculate analytics
    const totalReports = reports.length
    const totalRevenue = reports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const totalTips = reports.reduce((sum, r) => sum + r.tipCount, 0)
    const averageTips = totalReports > 0 ? totalRevenue > 0 ? (totalTips / totalReports) : 0 : 0
    
    const prepCompletions = reports.map(r => (r.morningPrepCompleted + r.eveningPrepCompleted) / 2)
    const avgPrepCompletion = prepCompletions.length > 0 
      ? Math.round(prepCompletions.reduce((sum, p) => sum + p, 0) / prepCompletions.length)
      : 0

    // Revenue by day for charts (with store breakdown if showing all stores)
    const revenueByDay = reports.reduce((acc, report) => {
      const dateKey = format(report.date, 'yyyy-MM-dd')
      if (!acc[dateKey]) {
        acc[dateKey] = { 
          date: dateKey, 
          revenue: 0, 
          tips: 0, 
          customers: 0, 
          reports: 0,
          ...(showAllStores ? { stores: {} } : {})
        }
      }
      acc[dateKey].revenue += report.totalSales || 0
      acc[dateKey].tips += report.tipCount
      acc[dateKey].customers += report.customerCount || 0
      acc[dateKey].reports += 1
      
      // Track per-store data if showing all stores
      if (showAllStores) {
        const storeName = report.store.name
        if (!acc[dateKey].stores[storeName]) {
          acc[dateKey].stores[storeName] = { revenue: 0, reports: 0 }
        }
        acc[dateKey].stores[storeName].revenue += report.totalSales || 0
        acc[dateKey].stores[storeName].reports += 1
      }
      
      return acc
    }, {} as Record<string, any>)

    const chartData = Object.values(revenueByDay)

    // Sales breakdown (cash vs card)
    const totalCash = reports.reduce((sum, r) => sum + (r.cashSales || 0), 0)
    const totalCard = reports.reduce((sum, r) => sum + (r.cardSales || 0), 0)
    
    // Recent reports for activity feed
    const recentReports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: storeIds }
      },
      include: {
        store: {
          select: { name: true }
        },
        manager: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    // Performance trends (last 7 days vs previous 7 days)
    const last7Days = subDays(endDate, 7)
    const previous7Days = subDays(last7Days, 7)

    const currentWeekReports = reports.filter(r => r.date >= last7Days)
    const previousWeekReports = reports.filter(r => 
      r.date >= previous7Days && r.date < last7Days
    )

    const currentWeekRevenue = currentWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const previousWeekRevenue = previousWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    
    const revenueGrowth = previousWeekRevenue > 0 
      ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100 
      : 0

    const analytics = {
      // Basic metrics
      todayReports,
      totalReports,
      totalRevenue,
      averageTips,
      avgPrepCompletion,
      
      // Chart data
      revenueByDay: chartData,
      
      // Sales breakdown
      salesBreakdown: {
        cash: totalCash,
        card: totalCard,
        cashPercentage: totalRevenue > 0 ? Math.round((totalCash / totalRevenue) * 100) : 0,
        cardPercentage: totalRevenue > 0 ? Math.round((totalCard / totalRevenue) * 100) : 0
      },
      
      // Performance trends
      trends: {
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        currentWeekRevenue,
        previousWeekRevenue
      },
      
      // Recent activity
      recentReports: recentReports.slice(0, 5).map(report => ({
        id: report.id,
        date: report.date,
        shift: report.shift,
        totalSales: report.totalSales,
        managerName: report.manager.name,
        storeName: report.store.name,
        createdAt: report.createdAt
      })),
      
      // Additional metadata
      isAllStores: showAllStores,
      storeCount: storeIds.length
    }

    const response = NextResponse.json(analytics)
    
    // Add cache headers
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    
    return response
  } catch (error) {
    console.error("Analytics error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}