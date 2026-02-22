import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { queryMetrics, buildDailySyncBody } from "@/lib/otter"

function isCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return authHeader === `Bearer ${cronSecret}`
}

export async function POST(request: NextRequest) {
  try {
    // Allow Vercel Cron or authenticated owner
    const fromCron = isCronRequest(request)
    if (!fromCron) {
      const session = await getServerSession(authOptions)
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      if (session.user.role !== "OWNER") {
        return NextResponse.json({ error: "Only owners can sync Otter data" }, { status: 403 })
      }
    }

    // Fetch all configured Otter stores
    const otterStores = await prisma.otterStore.findMany({
      include: { store: { select: { id: true, name: true, isActive: true } } },
    })

    if (otterStores.length === 0) {
      return NextResponse.json({
        message: "No Otter stores configured",
        synced: 0,
        failed: 0,
        storesProcessed: 0,
      })
    }

    const activeOtterStores = otterStores.filter((os) => os.store.isActive)
    const otterStoreIds = activeOtterStores.map((os) => os.otterStoreId)

    // 3-day lookback to catch late-arriving platform adjustments
    const endDate = new Date()
    endDate.setHours(23, 59, 59, 999)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 3)
    startDate.setHours(0, 0, 0, 0)

    const body = buildDailySyncBody(otterStoreIds, startDate, endDate)
    const rows = await queryMetrics(body)

    // Build lookup: otterStoreId → internal storeId
    const otterToInternal = new Map<string, string>(
      activeOtterStores.map((os) => [os.otterStoreId, os.storeId])
    )

    let synced = 0
    let failed = 0

    for (const row of rows) {
      try {
        const otterStoreId = row["store"] as string | null
        if (!otterStoreId) continue

        const storeId = otterToInternal.get(otterStoreId)
        if (!storeId) continue

        const dateStr = row["eod_date_with_timezone"] as string | null
        if (!dateStr) continue

        const date = new Date(dateStr)
        const platform = (row["pos_summary_ofo"] as string | null) ?? "unknown"
        const paymentMethod = (row["multi_value_pos_payment_method"] as string | null) ?? "N/A"

        await prisma.otterDailySummary.upsert({
          where: {
            storeId_date_platform_paymentMethod: {
              storeId,
              date,
              platform,
              paymentMethod,
            },
          },
          create: {
            storeId,
            date,
            platform,
            paymentMethod,
            fpGrossSales: row["fp_sales_financials_gross_sales"] as number | null,
            fpNetSales: row["fp_sales_financials_net_sales"] as number | null,
            fpDiscounts: row["fp_sales_financials_discounts"] as number | null,
            fpFees: row["fp_sales_financials_fees"] as number | null,
            fpLostRevenue: row["fp_sales_financials_lost_revenue"] as number | null,
            fpTaxCollected: row["fp_sales_financials_tax_collected"] as number | null,
            fpTaxRemitted: row["fp_sales_financials_tax_remitted"] as number | null,
            fpTips: row["fp_sales_financials_tips"] as number | null,
            fpServiceCharges: row["fp_sales_financials_service_charges"] as number | null,
            fpLoyalty: row["fp_sales_financials_loyalty"] as number | null,
            tpGrossSales: row["third_party_gross_sales"] as number | null,
            tpNetSales: row["third_party_net_sales"] as number | null,
            tpFees: row["third_party_fees"] as number | null,
            tpTaxCollected: row["third_party_tax_collected"] as number | null,
            tpTaxRemitted: row["third_party_tax_remitted"] as number | null,
            tpDiscounts: row["third_party_discounts"] as number | null,
            tpRefundsAdjustments: row["third_party_refunds_adjustments"] as number | null,
            tpServiceCharges: row["third_party_service_charges"] as number | null,
            tpTipForRestaurant: row["third_party_tip_for_restaurant"] as number | null,
            tpLoyaltyDiscount: row["third_party_loyalty_discount"] as number | null,
            tillPaidIn: row["enriched_till_report_paid_in"] as number | null,
            tillPaidOut: row["enriched_till_report_paid_out"] as number | null,
          },
          update: {
            fpGrossSales: row["fp_sales_financials_gross_sales"] as number | null,
            fpNetSales: row["fp_sales_financials_net_sales"] as number | null,
            fpDiscounts: row["fp_sales_financials_discounts"] as number | null,
            fpFees: row["fp_sales_financials_fees"] as number | null,
            fpLostRevenue: row["fp_sales_financials_lost_revenue"] as number | null,
            fpTaxCollected: row["fp_sales_financials_tax_collected"] as number | null,
            fpTaxRemitted: row["fp_sales_financials_tax_remitted"] as number | null,
            fpTips: row["fp_sales_financials_tips"] as number | null,
            fpServiceCharges: row["fp_sales_financials_service_charges"] as number | null,
            fpLoyalty: row["fp_sales_financials_loyalty"] as number | null,
            tpGrossSales: row["third_party_gross_sales"] as number | null,
            tpNetSales: row["third_party_net_sales"] as number | null,
            tpFees: row["third_party_fees"] as number | null,
            tpTaxCollected: row["third_party_tax_collected"] as number | null,
            tpTaxRemitted: row["third_party_tax_remitted"] as number | null,
            tpDiscounts: row["third_party_discounts"] as number | null,
            tpRefundsAdjustments: row["third_party_refunds_adjustments"] as number | null,
            tpServiceCharges: row["third_party_service_charges"] as number | null,
            tpTipForRestaurant: row["third_party_tip_for_restaurant"] as number | null,
            tpLoyaltyDiscount: row["third_party_loyalty_discount"] as number | null,
            tillPaidIn: row["enriched_till_report_paid_in"] as number | null,
            tillPaidOut: row["enriched_till_report_paid_out"] as number | null,
          },
        })
        synced++
      } catch (err) {
        console.error("Failed to upsert Otter row:", err, row)
        failed++
      }
    }

    // Update lastSyncAt for all processed stores
    await prisma.otterStore.updateMany({
      where: { otterStoreId: { in: otterStoreIds } },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json({
      message: `Otter sync completed: ${synced} rows upserted, ${failed} failed`,
      synced,
      failed,
      storesProcessed: activeOtterStores.length,
    })
  } catch (error) {
    console.error("Otter sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
