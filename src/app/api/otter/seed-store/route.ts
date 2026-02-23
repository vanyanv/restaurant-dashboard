import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { queryMetrics } from "@/lib/otter"

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can seed Otter stores" }, { status: 403 })
    }

    const { storeId, otterStoreIds } = await request.json()

    if (!storeId || typeof storeId !== "string") {
      return NextResponse.json({ error: "storeId is required" }, { status: 400 })
    }
    if (!Array.isArray(otterStoreIds) || otterStoreIds.length === 0) {
      return NextResponse.json({ error: "otterStoreIds array is required" }, { status: 400 })
    }

    // Verify the store exists and belongs to this owner
    const store = await prisma.store.findFirst({
      where: { id: storeId, ownerId: session.user.id },
    })
    if (!store) {
      return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 })
    }

    // Query Otter API for sales activity over the last 7 days
    const now = new Date()
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const body = {
      columns: [
        { type: "metric", key: "fp_sales_financials_gross_sales" },
        { type: "metric", key: "third_party_gross_sales" },
      ],
      groupBy: [{ key: "store" }],
      sortBy: [{ type: "metric", key: "fp_sales_financials_gross_sales", sortOrder: "DESC" }],
      filterSet: [{ filterType: "dateRangeFilter", minDate: sevenDaysAgo.toISOString(), maxDate: now.toISOString() }],
      scopeSet: [{ key: "store", values: otterStoreIds }],
      includeMetricsFilters: true,
      localTime: true,
      includeTotalRowCount: false,
      limit: 100,
      includeRawQueries: false,
    }

    const rows = await queryMetrics(body)

    // Find UUID with highest total sales
    const results = rows
      .map((row) => {
        const uuid = row["store"] as string | null
        if (!uuid) return null
        const fpGross = Number(row["fp_sales_financials_gross_sales"] ?? 0)
        const tpGross = Number(row["third_party_gross_sales"] ?? 0)
        return { uuid, fpGross, tpGross, total: fpGross + tpGross }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.total > 0)
      .sort((a, b) => b.total - a.total)

    if (results.length === 0) {
      return NextResponse.json(
        { error: "No Otter UUID had sales activity in the last 7 days" },
        { status: 404 }
      )
    }

    const detected = results[0]

    // Upsert OtterStore record
    const record = await prisma.otterStore.upsert({
      where: { storeId },
      create: { storeId, otterStoreId: detected.uuid },
      update: { otterStoreId: detected.uuid },
    })

    return NextResponse.json({
      message: "Otter store seeded successfully",
      detectedUUID: detected.uuid,
      fpGrossSales: detected.fpGross,
      tpGrossSales: detected.tpGross,
      totalSales: detected.total,
      candidateCount: results.length,
      record: {
        id: record.id,
        storeId: record.storeId,
        otterStoreId: record.otterStoreId,
        createdAt: record.createdAt,
      },
    })
  } catch (error) {
    console.error("Seed Otter store error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
