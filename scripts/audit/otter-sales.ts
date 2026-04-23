// Otter sales audit.
//
// Three checks on the sales ingestion pipeline:
//   1. summary_vs_orders_gap  — Σ OtterOrder.subtotal per day vs
//                               OtterDailySummary.(fpGrossSales + tpGrossSales)
//   2. orphan_menu_items      — OtterMenuItem rows with no OtterItemMapping and
//                               no exact-name fallback Recipe, weighted by revenue
//   3. tax_remitted_gap       — tax collected vs remitted gap per platform/day is
//                               fine (3P withholds), but flag days where the gap
//                               is negative (remitted > collected) — always a bug
//
// Run per-store. Days with low volume (< $100 total revenue) are ignored to
// reduce noise from test days / partial syncs.

import { loadEnvLocal, type Finding, classifyDollarDelta, money } from "./lib"

loadEnvLocal()

export async function auditOtterSales(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const findings: Finding[] = []

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true, ownerId: true },
  })

  for (const store of stores) {
    // ── 1. summary_vs_orders_gap ────────────────────────────────────
    // Σ orders per day (local-time grouping via SQL DATE(referenceTimeLocal))
    // vs daily summary row.
    //
    // KNOWN SEMANTIC MISMATCH: OtterOrder.subtotal is pre-discount sum of item
    // list prices; OtterDailySummary.{fp,tp}GrossSales is post-discount per
    // Otter's analytics API. The `discount` sign convention is also inconsistent
    // across time (older orders store positive, newer negative), so we can't
    // cleanly reconcile here. Consequence: we expect a ~10–30% gap on days with
    // normal promo activity. CRITICAL is reserved for >35% relative gap (likely
    // a sync issue or missing platform) rather than the typical discount drag.
    const orderTotals = await prisma.$queryRaw<Array<{ day: Date; totalSubtotal: number; orderCount: bigint }>>`
      SELECT date_trunc('day', "referenceTimeLocal") AS "day",
             SUM("subtotal")::float AS "totalSubtotal",
             COUNT(*)::bigint AS "orderCount"
      FROM "OtterOrder"
      WHERE "storeId" = ${store.id}
        AND "orderStatus" != 'OFO_STATUS_CANCELED'
      GROUP BY 1
    `
    const summaryTotals = await prisma.$queryRaw<Array<{ day: Date; fp: number | null; tp: number | null }>>`
      SELECT "date" AS "day",
             SUM(COALESCE("fpGrossSales",0))::float AS "fp",
             SUM(COALESCE("tpGrossSales",0))::float AS "tp"
      FROM "OtterDailySummary"
      WHERE "storeId" = ${store.id}
      GROUP BY "date"
    `
    const summaryByDay = new Map(
      summaryTotals.map((r) => [
        r.day.toISOString().slice(0, 10),
        (r.fp ?? 0) + (r.tp ?? 0),
      ])
    )
    for (const o of orderTotals) {
      const key = o.day.toISOString().slice(0, 10)
      const summary = summaryByDay.get(key) ?? 0
      const totalRev = Math.max(o.totalSubtotal, summary)
      if (totalRev < 100) continue
      const delta = o.totalSubtotal - summary
      const absDelta = Math.abs(delta)
      const relGap = absDelta / totalRev
      // Semantic-mismatch-aware severity: we expect 10–30% gap from discount-
      // accounting drift. Only flag as CRITICAL when the relative gap exceeds
      // 35%, which points to a real issue (sync lag, platform drop, etc.).
      let severity: "CRITICAL" | "WARNING" | "INFO"
      if (relGap >= 0.35 && absDelta >= 100) severity = "CRITICAL"
      else if (relGap >= 0.2 && absDelta >= 50) severity = "WARNING"
      else severity = "INFO"
      if (severity === "INFO") continue
      findings.push({
        domain: "otter-sales",
        check: "summary_vs_orders_gap",
        severity,
        message: `${store.name} ${key} — Σ orders ${money(o.totalSubtotal)} vs daily summary ${money(summary)} (Δ ${money(delta)})`,
        entity: { kind: "storeDay", id: `${store.id}::${key}`, label: `${store.name} ${key}` },
        details: {
          storeId: store.id,
          date: key,
          orderSubtotalSum: o.totalSubtotal,
          summaryGrossSum: summary,
          delta,
          orderCount: Number(o.orderCount),
        },
        deltaDollars: absDelta,
        deltaPct: totalRev > 0 ? absDelta / totalRev : null as unknown as number,
      })
    }

    // ── 2. orphan_menu_items ────────────────────────────────────────
    // Menu items (non-modifier) with no mapping. Use recipe-name fallback
    // (owner-scoped case-insensitive) as a permissive gate — only flag if
    // even that fallback doesn't resolve.
    const [menuAgg, mappings, recipes] = await Promise.all([
      prisma.otterMenuItem.groupBy({
        by: ["itemName"],
        where: { storeId: store.id, isModifier: false },
        _sum: { fpTotalSales: true, tpTotalSales: true, fpQuantitySold: true, tpQuantitySold: true },
      }),
      prisma.otterItemMapping.findMany({
        where: { storeId: store.id },
        select: { otterItemName: true },
      }),
      prisma.recipe.findMany({
        where: { ownerId: store.ownerId },
        select: { itemName: true },
      }),
    ])
    const mapped = new Set(mappings.map((m) => m.otterItemName))
    const recipeNames = new Set(recipes.map((r) => r.itemName.toLowerCase()))

    for (const row of menuAgg) {
      if (mapped.has(row.itemName)) continue
      if (recipeNames.has(row.itemName.toLowerCase())) continue
      const revenue = (row._sum.fpTotalSales ?? 0) + (row._sum.tpTotalSales ?? 0)
      if (revenue < 50) continue
      const severity: "CRITICAL" | "WARNING" = revenue >= 1000 ? "CRITICAL" : "WARNING"
      findings.push({
        domain: "otter-sales",
        check: "orphan_menu_item",
        severity,
        message: `${store.name} — "${row.itemName}" has ${money(revenue)} in sales but no recipe mapping`,
        entity: { kind: "menuItem", id: `${store.id}::${row.itemName}`, label: row.itemName },
        details: {
          storeId: store.id,
          itemName: row.itemName,
          revenue,
          qtySold: (row._sum.fpQuantitySold ?? 0) + (row._sum.tpQuantitySold ?? 0),
        },
        deltaDollars: revenue,
      })
    }

    // ── 3. tax_remitted_gap ─────────────────────────────────────────
    // Remitted > collected should never happen (you can't remit tax you
    // didn't collect). Flag any row where that's true.
    const taxAnomalies = await prisma.otterDailySummary.findMany({
      where: {
        storeId: store.id,
        OR: [
          { AND: [{ fpTaxRemitted: { gt: 0 } }, { fpTaxCollected: { lt: 0 } }] },
          { AND: [{ tpTaxRemitted: { gt: 0 } }, { tpTaxCollected: { lt: 0 } }] },
        ],
      },
      select: {
        id: true,
        date: true,
        platform: true,
        paymentMethod: true,
        fpTaxCollected: true,
        fpTaxRemitted: true,
        tpTaxCollected: true,
        tpTaxRemitted: true,
      },
    })
    // Also check arithmetic via collected − remitted < 0 directly in JS (Prisma
    // can't compare two columns easily without raw SQL).
    const tights = await prisma.otterDailySummary.findMany({
      where: { storeId: store.id },
      select: {
        id: true,
        date: true,
        platform: true,
        fpTaxCollected: true,
        fpTaxRemitted: true,
        tpTaxCollected: true,
        tpTaxRemitted: true,
      },
    })
    for (const row of tights) {
      const fpGap = (row.fpTaxCollected ?? 0) - (row.fpTaxRemitted ?? 0)
      const tpGap = (row.tpTaxCollected ?? 0) - (row.tpTaxRemitted ?? 0)
      if (fpGap < -0.01) {
        findings.push({
          domain: "otter-sales",
          check: "tax_remitted_exceeds_collected",
          severity: "WARNING",
          message: `${store.name} ${row.date.toISOString().slice(0, 10)} ${row.platform} FP — tax remitted ${money(row.fpTaxRemitted ?? 0)} exceeds collected ${money(row.fpTaxCollected ?? 0)} by ${money(-fpGap)}`,
          entity: { kind: "otterDailySummary", id: row.id },
          details: {
            storeId: store.id,
            date: row.date.toISOString().slice(0, 10),
            platform: row.platform,
            fpTaxCollected: row.fpTaxCollected,
            fpTaxRemitted: row.fpTaxRemitted,
            gap: fpGap,
          },
          deltaDollars: -fpGap,
        })
      }
      if (tpGap < -0.01) {
        findings.push({
          domain: "otter-sales",
          check: "tax_remitted_exceeds_collected",
          severity: "WARNING",
          message: `${store.name} ${row.date.toISOString().slice(0, 10)} ${row.platform} 3P — tax remitted ${money(row.tpTaxRemitted ?? 0)} exceeds collected ${money(row.tpTaxCollected ?? 0)} by ${money(-tpGap)}`,
          entity: { kind: "otterDailySummary", id: row.id },
          details: {
            storeId: store.id,
            date: row.date.toISOString().slice(0, 10),
            platform: row.platform,
            tpTaxCollected: row.tpTaxCollected,
            tpTaxRemitted: row.tpTaxRemitted,
            gap: tpGap,
          },
          deltaDollars: -tpGap,
        })
      }
    }
    void taxAnomalies
  }

  return findings
}

if (require.main === module) {
  auditOtterSales()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`otter-sales: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(async () => {
      const { prisma } = await import("../../src/lib/prisma")
      await prisma.$disconnect()
    })
}
