"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { z } from "zod"

const createManagerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export async function createManager(formData: FormData) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can create managers" }
    }

    const validatedData = createManagerSchema.parse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    })

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email }
    })

    if (existingUser) {
      return { error: "A user with this email already exists" }
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
      }
    })

    revalidatePath("/dashboard")
    return { success: true, manager }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("Create manager error:", error)
    return { error: "Failed to create manager" }
  }
}

export async function getManagers() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user || session.user.role !== "OWNER") {
      return []
    }

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

    return managers
  } catch (error) {
    console.error("Get managers error:", error)
    return []
  }
}

export async function getStoreManagers(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

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
      return []
    }

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

    return assignments.map(assignment => ({
      ...assignment.manager,
      assignmentId: assignment.id,
      assignedAt: assignment.createdAt.toISOString()
    }))
  } catch (error) {
    console.error("Get store managers error:", error)
    return []
  }
}

export async function assignManager(storeId: string, managerId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can assign managers" }
    }

    // Verify store exists and user owns it
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return { error: "Store not found or access denied" }
    }

    // Verify manager exists
    const manager = await prisma.user.findFirst({
      where: { 
        id: managerId,
        role: "MANAGER"
      }
    })

    if (!manager) {
      return { error: "Manager not found" }
    }

    // Check if already assigned
    const existingAssignment = await prisma.storeManager.findUnique({
      where: {
        storeId_managerId: {
          storeId,
          managerId
        }
      }
    })

    if (existingAssignment) {
      if (existingAssignment.isActive) {
        return { error: "Manager is already assigned to this store" }
      } else {
        // Reactivate existing assignment
        await prisma.storeManager.update({
          where: { id: existingAssignment.id },
          data: { isActive: true }
        })
      }
    } else {
      // Create new assignment
      await prisma.storeManager.create({
        data: {
          storeId,
          managerId,
          isActive: true
        }
      })
    }

    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Assign manager error:", error)
    return { error: "Failed to assign manager" }
  }
}

export async function unassignManager(storeId: string, managerId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can unassign managers" }
    }

    // Verify store exists and user owns it
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return { error: "Store not found or access denied" }
    }

    // Find and deactivate the assignment
    const assignment = await prisma.storeManager.findUnique({
      where: {
        storeId_managerId: {
          storeId,
          managerId
        }
      }
    })

    if (!assignment) {
      return { error: "Manager is not assigned to this store" }
    }

    await prisma.storeManager.update({
      where: { id: assignment.id },
      data: { isActive: false }
    })

    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Unassign manager error:", error)
    return { error: "Failed to unassign manager" }
  }
}