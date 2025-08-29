import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const createReportSchema = z.object({
  storeId: z.string().min(1),
  date: z.string(),
  shift: z.enum(["MORNING", "EVENING", "BOTH"]),
  startingAmount: z.number(),
  endingAmount: z.number(),
  totalSales: z.number().nullable().optional(),
  cashSales: z.number().nullable().optional(),
  cardSales: z.number().nullable().optional(),
  tipCount: z.number(),
  cashTips: z.number().nullable().optional(),
  morningPrepCompleted: z.number().min(0).max(100),
  eveningPrepCompleted: z.number().min(0).max(100),
  // New prep completion checkboxes
  prepMeat: z.boolean().optional(),
  prepSauce: z.boolean().optional(),
  prepOnionsSliced: z.boolean().optional(),
  prepOnionsDiced: z.boolean().optional(),
  prepTomatoesSliced: z.boolean().optional(),
  prepLettuce: z.boolean().optional(),
  customerCount: z.number().nullable().optional(),
  notes: z.string().optional()
})

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get("storeId")
    const date = searchParams.get("date")
    const shift = searchParams.get("shift")
    const limit = parseInt(searchParams.get("limit") || "50")

    let baseWhere: any = session.user.role === "OWNER"
      ? { store: { ownerId: session.user.id } }
      : { managerId: session.user.id }

    // Add additional filters
    if (storeId) {
      if (session.user.role === "MANAGER") {
        // Verify manager has access to this store
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
      }
      baseWhere.storeId = storeId
    }

    if (date) {
      baseWhere.date = new Date(date + 'T00:00:00Z')
    }

    if (shift && shift !== "BOTH") {
      baseWhere.shift = shift
    }

    const reports = await prisma.dailyReport.findMany({
      where: baseWhere,
      include: {
        store: true,
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { date: 'desc' },
      take: limit
    })

    return NextResponse.json(reports)
  } catch (error) {
    console.error("Get reports error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const validatedData = createReportSchema.parse(body)

    // Check if user has access to this store
    const store = await prisma.store.findFirst({
      where: {
        id: validatedData.storeId,
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

    // Use upsert to create or update existing report
    const report = await prisma.dailyReport.upsert({
      where: {
        storeId_date_shift: {
          storeId: validatedData.storeId,
          date: new Date(validatedData.date),
          shift: validatedData.shift
        }
      },
      create: {
        ...validatedData,
        date: new Date(validatedData.date),
        managerId: session.user.id
      },
      update: {
        ...validatedData,
        date: new Date(validatedData.date),
        managerId: session.user.id,
        updatedAt: new Date() // Explicitly update timestamp
      },
      include: {
        store: true
      }
    })

    return NextResponse.json(report, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues },
        { status: 400 }
      )
    }
    
    console.error("Create report error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}