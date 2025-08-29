import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const assignManagerSchema = z.object({
  managerId: z.string().min(1, "Manager ID is required"),
})

const unassignManagerSchema = z.object({
  managerId: z.string().min(1, "Manager ID is required"),
})

// Get managers assigned to a specific store
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: storeId } = await context.params

    // Verify user has access to this store
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

    // Get assigned managers for this store
    const assignments = await prisma.storeManager.findMany({
      where: {
        storeId: storeId,
        isActive: true
      },
      include: {
        manager: {
          select: {
            id: true,
            email: true,
            name: true,
            _count: {
              select: {
                reports: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const managers = assignments.map(assignment => ({
      assignmentId: assignment.id,
      assignedAt: assignment.createdAt,
      ...assignment.manager
    }))

    return NextResponse.json(managers)
  } catch (error) {
    console.error("Get store managers error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Assign manager to store
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can assign managers" }, { status: 403 })
    }

    const { id: storeId } = await context.params
    const body = await req.json()
    const validatedData = assignManagerSchema.parse(body)

    // Verify store exists and user owns it
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 })
    }

    // Verify manager exists and is a manager role
    const manager = await prisma.user.findFirst({
      where: { 
        id: validatedData.managerId,
        role: "MANAGER"
      }
    })

    if (!manager) {
      return NextResponse.json({ error: "Manager not found" }, { status: 404 })
    }

    // Check if manager is already assigned to this store
    const existingAssignment = await prisma.storeManager.findUnique({
      where: {
        storeId_managerId: {
          storeId: storeId,
          managerId: validatedData.managerId
        }
      }
    })

    if (existingAssignment) {
      if (existingAssignment.isActive) {
        return NextResponse.json(
          { error: "Manager is already assigned to this store" },
          { status: 400 }
        )
      } else {
        // Reactivate existing assignment
        const reactivatedAssignment = await prisma.storeManager.update({
          where: { id: existingAssignment.id },
          data: { isActive: true },
          include: {
            manager: {
              select: {
                id: true,
                email: true,
                name: true
              }
            },
            store: {
              select: {
                id: true,
                name: true
              }
            }
          }
        })

        return NextResponse.json(reactivatedAssignment, { status: 200 })
      }
    }

    // Create new assignment
    const assignment = await prisma.storeManager.create({
      data: {
        storeId: storeId,
        managerId: validatedData.managerId,
        isActive: true
      },
      include: {
        manager: {
          select: {
            id: true,
            email: true,
            name: true
          }
        },
        store: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    return NextResponse.json(assignment, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues },
        { status: 400 }
      )
    }
    
    console.error("Assign manager error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Unassign manager from store
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can unassign managers" }, { status: 403 })
    }

    const { id: storeId } = await context.params
    const { searchParams } = new URL(req.url)
    const managerId = searchParams.get('managerId')

    if (!managerId) {
      return NextResponse.json({ error: "Manager ID is required" }, { status: 400 })
    }

    // Verify store exists and user owns it
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 })
    }

    // Find the assignment
    const assignment = await prisma.storeManager.findUnique({
      where: {
        storeId_managerId: {
          storeId: storeId,
          managerId: managerId
        }
      }
    })

    if (!assignment) {
      return NextResponse.json({ error: "Manager is not assigned to this store" }, { status: 404 })
    }

    // Deactivate the assignment (soft delete)
    await prisma.storeManager.update({
      where: { id: assignment.id },
      data: { isActive: false }
    })

    return NextResponse.json({ message: "Manager unassigned successfully" })
  } catch (error) {
    console.error("Unassign manager error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}