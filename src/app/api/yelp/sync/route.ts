import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getYelpService } from "@/lib/yelp"

// Sync all stores owned by the user
export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can sync Yelp data" }, { status: 403 })
    }

    // Get all active stores owned by the user
    const stores = await prisma.store.findMany({
      where: {
        ownerId: session.user.id,
        isActive: true,
        address: {
          not: null
        }
      },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        yelpLastSearch: true
      }
    })

    if (stores.length === 0) {
      return NextResponse.json({ 
        message: "No stores found with addresses to sync",
        synced: 0,
        failed: 0
      })
    }

    const yelpService = getYelpService()
    const results = {
      synced: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{
        storeId: string
        storeName: string
        status: 'synced' | 'failed' | 'skipped'
        rating: number | null
        reviewCount: number | null
        error?: string
      }>
    }

    // Rate limiting: Don't sync stores that were searched in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    for (const store of stores) {
      try {
        // Skip if recently searched (unless forced)
        if (store.yelpLastSearch && store.yelpLastSearch > twentyFourHoursAgo) {
          results.skipped++
          results.details.push({
            storeId: store.id,
            storeName: store.name,
            status: 'skipped',
            rating: null,
            reviewCount: null,
            error: 'Recently searched (within 24 hours)'
          })
          continue
        }

        // Search Yelp for this store
        const yelpData = await yelpService.getStoreYelpData(
          store.name,
          store.address,
          store.phone
        )

        // Update store with Yelp data
        const searchTerm = `${store.name} ${store.address}`
        
        await prisma.store.update({
          where: { id: store.id },
          data: {
            yelpBusinessId: yelpData?.businessId || null,
            yelpRating: yelpData?.rating || null,
            yelpReviewCount: yelpData?.reviewCount || null,
            yelpUrl: yelpData?.url || null,
            yelpUpdatedAt: yelpData ? new Date() : null,
            yelpSearchTerm: searchTerm,
            yelpLastSearch: new Date()
          }
        })

        results.synced++
        results.details.push({
          storeId: store.id,
          storeName: store.name,
          status: 'synced',
          rating: yelpData?.rating || null,
          reviewCount: yelpData?.reviewCount || null
        })

        // Add small delay to be respectful to Yelp API
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        results.failed++
        results.details.push({
          storeId: store.id,
          storeName: store.name,
          status: 'failed',
          rating: null,
          reviewCount: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        console.error(`Failed to sync Yelp data for store ${store.name}:`, error)
      }
    }

    return NextResponse.json({
      message: `Yelp sync completed: ${results.synced} synced, ${results.failed} failed, ${results.skipped} skipped`,
      ...results
    })

  } catch (error) {
    console.error("Yelp sync error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}