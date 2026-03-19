import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { queryRatings, buildRatingsBody, withConcurrency } from "@/lib/otter"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OtterRow = Record<string, any>

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  const fromCron = isCronRequest(request)
  if (!fromCron) {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can sync ratings" }, { status: 403 })
    }
  }

  try {
    let days = 21
    try {
      const body = await request.json()
      if (body.days && typeof body.days === "number") days = body.days
    } catch {
      // No body or invalid JSON — use default
    }

    const otterStores = await prisma.otterStore.findMany({
      include: { store: { select: { id: true, name: true, isActive: true } } },
    })

    if (otterStores.length === 0) {
      return NextResponse.json({ synced: 0, failed: 0, message: "No Otter stores configured" })
    }

    const activeOtterStores = otterStores.filter((os) => os.store.isActive)

    // Group Otter UUIDs by internal storeId (multiple UUIDs may map to one store)
    const storeGroups = new Map<string, string[]>()
    for (const os of activeOtterStores) {
      const uuids = storeGroups.get(os.storeId) ?? []
      uuids.push(os.otterStoreId)
      storeGroups.set(os.storeId, uuids)
    }

    const endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    startDate.setHours(0, 0, 0, 0)

    // Fetch ratings per-store so we know which storeId each row belongs to
    const tasks = [...storeGroups.entries()].map(([storeId, uuids]) => () =>
      queryRatings(buildRatingsBody(uuids, startDate, endDate))
        .then((rows: OtterRow[]) => ({ storeId, rows }))
        .catch((err: unknown) => {
          console.error(`Ratings sync error for store ${storeId}:`, err)
          return { storeId, rows: [] as OtterRow[] }
        })
    )

    const results = await withConcurrency(tasks, 3)

    let synced = 0
    let failed = 0
    let totalRows = 0

    for (const { storeId, rows } of results) {
      totalRows += rows.length

      const records = rows
        .filter((row) => row["external_review_id"] && row["order_rating"] != null)
        .map((row) => {
          // order_reviewed_at is epoch millis
          const reviewedAtRaw = row["order_reviewed_at"]
          const reviewedAt = typeof reviewedAtRaw === "number"
            ? new Date(reviewedAtRaw)
            : new Date(String(reviewedAtRaw))

          return {
            storeId,
            externalReviewId: String(row["external_review_id"]),
            brandName: (row["brand_name"] as string) ?? "",
            facilityName: (row["facility_name"] as string) ?? "",
            storeName: (row["store_name"] as string) ?? "",
            reviewedAt,
            platform: (row["ofo_slug"] as string) ?? "unknown",
            reviewText: (row["order_review_full_text"] as string) || null,
            rating: Number(row["order_rating"]),
            externalOrderId: row["external_order_id"] ? String(row["external_order_id"]) : null,
            orderItemNames: (row["order_items_names"] as string) || null,
          }
        })

      // Batch upsert
      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50)
        try {
          await prisma.$transaction(
            batch.map(({ storeId: sid, externalReviewId, ...data }) =>
              prisma.otterRating.upsert({
                where: {
                  storeId_externalReviewId: { storeId: sid, externalReviewId },
                },
                create: { storeId: sid, externalReviewId, ...data },
                update: data,
              })
            )
          )
          synced += batch.length
        } catch (err) {
          console.error(`Failed batch of ${batch.length} rating upserts:`, err)
          failed += batch.length
        }
      }
    }

    return NextResponse.json({
      synced,
      failed,
      total: totalRows,
      message: `Ratings sync: ${synced} synced, ${failed} failed out of ${totalRows} rows`,
    })
  } catch (error) {
    console.error("Ratings sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
