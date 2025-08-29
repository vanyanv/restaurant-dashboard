import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getYelpService } from "@/lib/yelp"

// Sync specific store
export async function POST(
  request: Request,
  props: { params: Promise<{ storeId: string }> }
) {
  try {
    const params = await props.params
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can sync Yelp data" }, { status: 403 })
    }

    // Get the specific store and verify ownership
    const store = await prisma.store.findFirst({
      where: {
        id: params.storeId,
        ownerId: session.user.id,
        isActive: true
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        yelpRating: true,
        yelpReviewCount: true,
        yelpUpdatedAt: true
      }
    })

    if (!store) {
      return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 })
    }

    if (!store.address) {
      return NextResponse.json({ 
        error: "Cannot sync Yelp data for store without address" 
      }, { status: 400 })
    }

    try {
      const yelpService = getYelpService()
      
      // Search Yelp for this store
      const yelpData = await yelpService.getStoreYelpData(
        store.name,
        store.address,
        store.phone
      )

      // Update store with Yelp data
      const searchTerm = `${store.name} ${store.address}`
      
      const updatedStore = await prisma.store.update({
        where: { id: store.id },
        data: {
          yelpBusinessId: yelpData?.businessId || null,
          yelpRating: yelpData?.rating || null,
          yelpReviewCount: yelpData?.reviewCount || null,
          yelpUrl: yelpData?.url || null,
          yelpUpdatedAt: yelpData ? new Date() : null,
          yelpSearchTerm: searchTerm,
          yelpLastSearch: new Date()
        },
        select: {
          id: true,
          name: true,
          yelpRating: true,
          yelpReviewCount: true,
          yelpUrl: true,
          yelpUpdatedAt: true
        }
      })

      return NextResponse.json({
        message: yelpData 
          ? `Successfully synced Yelp data for ${store.name}`
          : `No matching Yelp business found for ${store.name}`,
        store: updatedStore,
        found: !!yelpData,
        matchScore: yelpData?.matchScore || null
      })

    } catch (error) {
      console.error(`Failed to sync Yelp data for store ${store.name}:`, error)
      
      // Still update the lastSearch timestamp to prevent immediate retries
      await prisma.store.update({
        where: { id: store.id },
        data: {
          yelpLastSearch: new Date()
        }
      })

      return NextResponse.json({ 
        error: error instanceof Error ? error.message : "Failed to fetch Yelp data",
        store: {
          id: store.id,
          name: store.name,
          yelpRating: store.yelpRating,
          yelpReviewCount: store.yelpReviewCount,
          yelpUpdatedAt: store.yelpUpdatedAt
        },
        found: false
      }, { status: 500 })
    }

  } catch (error) {
    console.error("Yelp sync error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}