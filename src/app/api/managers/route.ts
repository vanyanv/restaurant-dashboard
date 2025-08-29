import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { z } from "zod"

const createManagerSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

const updateManagerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long").optional(),
  email: z.string().email("Invalid email address").optional(),
  isActive: z.boolean().optional(),
})

// Get all managers (OWNER only)
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can view managers" }, { status: 403 })
    }

    // Get all managers and their store assignments
    const managers = await prisma.user.findMany({
      where: { 
        role: "MANAGER"
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        managedStores: {
          where: { isActive: true },
          include: {
            store: {
              select: {
                id: true,
                name: true,
                address: true,
              }
            }
          }
        },
        _count: {
          select: {
            reports: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(managers)
  } catch (error) {
    console.error("Get managers error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Create new manager (OWNER only)
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can create managers" }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = createManagerSchema.parse(body)

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(validatedData.password, 10)

    // Create manager
    const manager = await prisma.user.create({
      data: {
        email: validatedData.email,
        password: hashedPassword,
        name: validatedData.name,
        role: "MANAGER"
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    })

    return NextResponse.json(manager, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues },
        { status: 400 }
      )
    }
    
    console.error("Create manager error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Update manager (OWNER only)
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can update managers" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const managerId = searchParams.get('id')

    if (!managerId) {
      return NextResponse.json({ error: "Manager ID is required" }, { status: 400 })
    }

    const body = await req.json()
    const validatedData = updateManagerSchema.parse(body)

    // Check if manager exists
    const existingManager = await prisma.user.findFirst({
      where: { 
        id: managerId,
        role: "MANAGER"
      }
    })

    if (!existingManager) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    // Check if email is already taken (if being updated)
    if (validatedData.email && validatedData.email !== existingManager.email) {
      const emailExists = await prisma.user.findUnique({
        where: { email: validatedData.email }
      })

      if (emailExists) {
        return NextResponse.json(
          { error: "Email is already taken" },
          { status: 400 }
        )
      }
    }

    // Update manager
    const updatedManager = await prisma.user.update({
      where: { id: managerId },
      data: validatedData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    })

    return NextResponse.json(updatedManager)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues },
        { status: 400 }
      )
    }
    
    console.error("Update manager error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}