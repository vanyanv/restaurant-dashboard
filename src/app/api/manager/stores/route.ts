import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "MANAGER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const assignments = await prisma.storeManager.findMany({
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
            phone: true,
            isActive: true
          }
        }
      }
    })

    const stores = assignments.map(assignment => assignment.store)
    
    return NextResponse.json(stores)
  } catch (error) {
    console.error("Get manager stores error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}