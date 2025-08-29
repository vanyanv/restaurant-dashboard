import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { startOfWeek, endOfWeek } from "date-fns"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Get assigned stores
    const storeAssignments = await prisma.storeManager.findMany({
      where: {
        managerId: session.user.id,
        isActive: true
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            address: true,
            isActive: true
          }
        }
      }
    })

    const storeIds = storeAssignments.map(a => a.store.id)

    // Get recent reports for all assigned stores
    const recentReports = await prisma.dailyReport.findMany({
      where: {
        managerId: session.user.id,
        storeId: { in: storeIds }
      },
      include: {
        store: {
          select: {
            name: true
          }
        }
      },
      orderBy: { date: 'desc' },
      take: 20
    })

    // Calculate weekly stats
    const weekStart = startOfWeek(new Date())
    const weekEnd = endOfWeek(new Date())

    const weeklyReports = await prisma.dailyReport.findMany({
      where: {
        managerId: session.user.id,
        storeId: { in: storeIds },
        date: {
          gte: weekStart,
          lte: weekEnd
        }
      }
    })

    const weeklyStats = {
      totalReports: weeklyReports.length,
      avgPrepCompletion: weeklyReports.length > 0
        ? weeklyReports.reduce((acc, report) => {
            const completion = report.shift === "MORNING" 
              ? report.morningPrepCompleted 
              : report.eveningPrepCompleted
            return acc + (completion || 0)
          }, 0) / weeklyReports.length
        : 0,
      expectedReports: storeIds.length * 14, // 2 shifts per day * 7 days
      missedShifts: Math.max(0, storeIds.length * 14 - weeklyReports.length)
    }

    // Group stores with their recent reports
    const storesWithData = storeAssignments.map(assignment => {
      const storeReports = recentReports.filter(r => r.storeId === assignment.store.id)
      
      const completionRate = storeReports.length > 0
        ? storeReports.reduce((acc, report) => {
            const completion = report.shift === "MORNING" 
              ? report.morningPrepCompleted 
              : report.eveningPrepCompleted
            return acc + (completion || 0)
          }, 0) / storeReports.length
        : 0

      return {
        ...assignment.store,
        recentReports: storeReports.slice(0, 7), // Last 7 reports per store
        completionRate,
        lastReportDate: storeReports[0]?.date || null,
        assignedAt: assignment.createdAt
      }
    })

    return NextResponse.json({
      stores: storesWithData,
      weeklyStats,
      totalReports: recentReports.length
    })
  } catch (error) {
    console.error("Get manager dashboard error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}