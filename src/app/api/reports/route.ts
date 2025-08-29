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
  morningPrepCompleted: z.number().min(0).max(100),
  eveningPrepCompleted: z.number().min(0).max(100),
  customerCount: z.number().nullable().optional(),
  notes: z.string().optional()
})

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const reports = await prisma.dailyReport.findMany({
      where: session.user.role === "OWNER"
        ? {
            store: { ownerId: session.user.id }
          }
        : {
            managerId: session.user.id
          },
      include: {
        store: true,
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { date: 'desc' }
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

    // Check if report already exists for this date and shift
    const existingReport = await prisma.dailyReport.findUnique({
      where: {
        storeId_date_shift: {
          storeId: validatedData.storeId,
          date: new Date(validatedData.date),
          shift: validatedData.shift
        }
      }
    })

    if (existingReport) {
      return NextResponse.json(
        { error: "Report already exists for this date and shift" },
        { status: 400 }
      )
    }

    const report = await prisma.dailyReport.create({
      data: {
        ...validatedData,
        date: new Date(validatedData.date),
        managerId: session.user.id
      },
      include: {
        store: true
      }
    })

    return NextResponse.json(report, { status: 201 })
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