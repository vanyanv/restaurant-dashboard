import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const createReportSchema = z.object({
  storeId: z.string().min(1, "Store is required"),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  shift: z.enum(["MORNING", "EVENING"]),
  startingAmount: z.number().min(0),
  endingAmount: z.number().min(0),
  tipCount: z.number().min(0),
  cashTips: z.number().min(0).optional().default(0),
  morningPrepCompleted: z.number().int().min(0).max(100),
  eveningPrepCompleted: z.number().int().min(0).max(100),
  prepMeat: z.boolean().default(false),
  prepSauce: z.boolean().default(false),
  prepOnionsSliced: z.boolean().default(false),
  prepOnionsDiced: z.boolean().default(false),
  prepTomatoesSliced: z.boolean().default(false),
  prepLettuce: z.boolean().default(false),
  notes: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const body = await request.json()
    const validatedData = createReportSchema.parse(body)

    // Verify manager has access to this store
    const storeAccess = await prisma.storeManager.findFirst({
      where: {
        storeId: validatedData.storeId,
        managerId: session.user.id,
        isActive: true
      }
    })

    if (!storeAccess) {
      return NextResponse.json({ error: "You don't have access to this store" }, { status: 403 })
    }

    // Parse date properly
    const reportDate = validatedData.date.includes('T') 
      ? new Date(validatedData.date)
      : new Date(validatedData.date + 'T00:00:00Z')

    // Check if report already exists for this store/date/shift
    const existingReport = await prisma.dailyReport.findUnique({
      where: {
        storeId_date_shift: {
          storeId: validatedData.storeId,
          date: reportDate,
          shift: validatedData.shift
        }
      }
    })

    let report
    if (existingReport) {
      // Update existing report
      report = await prisma.dailyReport.update({
        where: { id: existingReport.id },
        data: {
          ...validatedData,
          date: reportDate,
          managerId: session.user.id,
          updatedAt: new Date()
        },
        include: {
          store: {
            select: {
              name: true
            }
          },
          manager: {
            select: {
              name: true
            }
          }
        }
      })
    } else {
      // Create new report
      report = await prisma.dailyReport.create({
        data: {
          ...validatedData,
          date: reportDate,
          managerId: session.user.id
        },
        include: {
          store: {
            select: {
              name: true
            }
          },
          manager: {
            select: {
              name: true
            }
          }
        }
      })
    }

    return NextResponse.json(report, { status: existingReport ? 200 : 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.issues },
        { status: 400 }
      )
    }
    
    console.error("Create manager report error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const storeId = searchParams.get("storeId")
    const date = searchParams.get("date")
    const shift = searchParams.get("shift")
    const limit = parseInt(searchParams.get("limit") || "10")

    let whereClause: any = {
      managerId: session.user.id
    }

    if (storeId) {
      // Verify access to store
      const storeAccess = await prisma.storeManager.findFirst({
        where: {
          storeId: storeId,
          managerId: session.user.id,
          isActive: true
        }
      })

      if (!storeAccess) {
        return NextResponse.json({ error: "Access denied to this store" }, { status: 403 })
      }

      whereClause.storeId = storeId
    }

    if (date) {
      whereClause.date = new Date(date + 'T00:00:00Z')
    }

    if (shift) {
      whereClause.shift = shift
    }

    const reports = await prisma.dailyReport.findMany({
      where: whereClause,
      include: {
        store: {
          select: {
            name: true,
            address: true
          }
        }
      },
      orderBy: { date: 'desc' },
      take: limit
    })

    return NextResponse.json(reports)
  } catch (error) {
    console.error("Get manager reports error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}