"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"

async function getStoreIds(storeId?: string): Promise<string[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  if (storeId) return [storeId]

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true },
  })
  return stores.map((s) => s.id)
}

export interface RatingsAnalyticsData {
  avgRating: number
  totalReviews: number
  textReviewPct: number
  ratingTrend: number // delta vs previous period
  distribution: { rating: number; count: number }[]
  dailyAvg: { date: string; avgRating: number; count: number }[]
  byStore: { storeId: string; storeName: string; avgRating: number; count: number }[]
  byPlatform: { platform: string; avgRating: number; count: number }[]
  recentReviews: {
    id: string
    storeName: string
    platform: string
    rating: number
    reviewText: string | null
    reviewedAt: string
    orderItemNames: string | null
  }[]
}

export async function getRatingsAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<RatingsAnalyticsData | null> {
  try {
    const storeIds = await getStoreIds(storeId)
    if (storeIds.length === 0) return null

    const days = options?.days ?? 21
    let rangeStart: Date
    let rangeEnd: Date

    if (options?.startDate && options?.endDate) {
      rangeStart = new Date(options.startDate + "T00:00:00Z")
      rangeEnd = new Date(options.endDate + "T23:59:59.999Z")
    } else {
      const today = todayInLA()
      rangeEnd = endOfDayLA(today)
      rangeStart = startOfDayLA(today)
      rangeStart.setDate(rangeStart.getDate() - days)
    }

    const ratings = await prisma.otterRating.findMany({
      where: {
        storeId: { in: storeIds },
        reviewedAt: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { reviewedAt: "desc" },
    })

    if (ratings.length === 0) {
      return {
        avgRating: 0,
        totalReviews: 0,
        textReviewPct: 0,
        ratingTrend: 0,
        distribution: [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: 0 })),
        dailyAvg: [],
        byStore: [],
        byPlatform: [],
        recentReviews: [],
      }
    }

    // KPIs
    const totalReviews = ratings.length
    const avgRating = ratings.reduce((sum, r) => sum + r.rating, 0) / totalReviews
    const textReviews = ratings.filter((r) => r.reviewText).length
    const textReviewPct = Math.round((textReviews / totalReviews) * 100)

    // Trend: compare with previous equal-length period
    const periodMs = rangeEnd.getTime() - rangeStart.getTime()
    const prevStart = new Date(rangeStart.getTime() - periodMs)
    const prevEnd = new Date(rangeStart.getTime() - 1)

    const prevRatings = await prisma.otterRating.findMany({
      where: {
        storeId: { in: storeIds },
        reviewedAt: { gte: prevStart, lte: prevEnd },
      },
      select: { rating: true },
    })

    const prevAvg = prevRatings.length > 0
      ? prevRatings.reduce((sum, r) => sum + r.rating, 0) / prevRatings.length
      : avgRating
    const ratingTrend = Math.round((avgRating - prevAvg) * 100) / 100

    // Distribution
    const distMap = new Map<number, number>()
    for (const r of ratings) {
      distMap.set(r.rating, (distMap.get(r.rating) ?? 0) + 1)
    }
    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: distMap.get(rating) ?? 0,
    }))

    // Daily average
    const dailyMap = new Map<string, { sum: number; count: number }>()
    for (const r of ratings) {
      const dateKey = r.reviewedAt.toISOString().slice(0, 10)
      const entry = dailyMap.get(dateKey) ?? { sum: 0, count: 0 }
      entry.sum += r.rating
      entry.count++
      dailyMap.set(dateKey, entry)
    }
    const dailyAvg = Array.from(dailyMap.entries())
      .map(([date, { sum, count }]) => ({
        date,
        avgRating: Math.round((sum / count) * 100) / 100,
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // By store
    const storeMap = new Map<string, { storeName: string; sum: number; count: number }>()
    for (const r of ratings) {
      const entry = storeMap.get(r.storeId) ?? { storeName: r.storeName || r.facilityName, sum: 0, count: 0 }
      entry.sum += r.rating
      entry.count++
      storeMap.set(r.storeId, entry)
    }
    const byStore = Array.from(storeMap.entries())
      .map(([storeId, { storeName, sum, count }]) => ({
        storeId,
        storeName,
        avgRating: Math.round((sum / count) * 100) / 100,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    // By platform
    const platformMap = new Map<string, { sum: number; count: number }>()
    for (const r of ratings) {
      const entry = platformMap.get(r.platform) ?? { sum: 0, count: 0 }
      entry.sum += r.rating
      entry.count++
      platformMap.set(r.platform, entry)
    }
    const byPlatform = Array.from(platformMap.entries())
      .map(([platform, { sum, count }]) => ({
        platform,
        avgRating: Math.round((sum / count) * 100) / 100,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    // Recent reviews (limit 100)
    const recentReviews = ratings.slice(0, 100).map((r) => ({
      id: r.id,
      storeName: r.storeName || r.facilityName,
      platform: r.platform,
      rating: r.rating,
      reviewText: r.reviewText,
      reviewedAt: r.reviewedAt.toISOString(),
      orderItemNames: r.orderItemNames,
    }))

    return {
      avgRating: Math.round(avgRating * 100) / 100,
      totalReviews,
      textReviewPct,
      ratingTrend,
      distribution,
      dailyAvg,
      byStore,
      byPlatform,
      recentReviews,
    }
  } catch (error) {
    console.error("getRatingsAnalytics error:", error)
    return null
  }
}
