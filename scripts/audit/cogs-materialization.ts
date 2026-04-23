// COGS-materialization audit.
//
// Three checks against DailyCogsItem:
//   1. unmapped_weighted     — rows with status=UNMAPPED/MISSING_COST weighted by revenue
//   2. stale_vs_asof         — unitCost differs from computeRecipeCost(asOf=date) for
//                              a random sample of rows (catches stale snapshots that
//                              were written before a price change)
//   3. cogs_without_revenue  — rows with lineCost > 0 but salesRevenue == 0 (data gap)
//
// We sample for check 2 rather than recomputing the full period — a full recompute
// is effectively the materializer itself. N=25 rows per owner keeps runtime sane.

import { loadEnvLocal, type Finding, classifyDollarDelta, money } from "./lib"

loadEnvLocal()

export async function auditCogsMaterialization(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const { computeRecipeCost } = await import("../../src/lib/recipe-cost")
  const findings: Finding[] = []

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true, ownerId: true },
  })

  // ── 1. unmapped_weighted ─────────────────────────────────────────────
  // Aggregate per-store: revenue with status UNMAPPED or MISSING_COST.
  // Only flag if the unmapped share exceeds 2% of total revenue on the store,
  // which is when it actually distorts KPIs.
  for (const store of stores) {
    const [byStatus, total] = await Promise.all([
      prisma.dailyCogsItem.groupBy({
        by: ["status"],
        where: { storeId: store.id },
        _sum: { salesRevenue: true, lineCost: true },
        _count: { _all: true },
      }),
      prisma.dailyCogsItem.aggregate({
        where: { storeId: store.id },
        _sum: { salesRevenue: true },
      }),
    ])
    const totalRev = total._sum.salesRevenue ?? 0
    if (totalRev === 0) continue

    for (const row of byStatus) {
      if (row.status === "COSTED") continue
      const rev = row._sum.salesRevenue ?? 0
      if (rev === 0) continue
      const share = rev / totalRev
      if (share < 0.02) continue
      const severity: "CRITICAL" | "WARNING" = share >= 0.1 ? "CRITICAL" : "WARNING"
      findings.push({
        domain: "cogs-materialization",
        check: "unmapped_weighted",
        severity,
        message: `${store.name} — ${row.status} covers ${(share * 100).toFixed(1)}% of revenue (${money(rev)} over ${row._count._all} rows)`,
        entity: { kind: "store", id: store.id, label: store.name },
        details: {
          storeId: store.id,
          ownerId: store.ownerId,
          status: row.status,
          revenue: rev,
          rows: row._count._all,
          totalRevenue: totalRev,
          share,
        },
        deltaDollars: rev,
        deltaPct: share,
      })
    }
  }

  // ── 2. stale_vs_asof ────────────────────────────────────────────────
  // Sample up to 25 COSTED rows per store (recent first), and recompute.
  for (const store of stores) {
    const sample = await prisma.dailyCogsItem.findMany({
      where: { storeId: store.id, status: "COSTED", recipeId: { not: null }, unitCost: { not: null } },
      select: { id: true, date: true, itemName: true, qtySold: true, unitCost: true, lineCost: true, recipeId: true },
      orderBy: { date: "desc" },
      take: 25,
    })

    for (const row of sample) {
      if (!row.recipeId) continue
      let recomputed: number | null = null
      try {
        const result = await computeRecipeCost(row.recipeId, row.date)
        recomputed = result.totalCost
      } catch {
        continue // cycle or missing recipe — separate domain flags it
      }
      if (recomputed == null || row.unitCost == null) continue
      // The materialized unitCost legitimately INCLUDES modifier cost (base +
      // Σ modifiers per order), while computeRecipeCost(asOf) returns the base
      // recipe only. So stored ≥ recompute is expected. We only flag when
      // stored is MATERIALLY LOWER than a fresh base recompute — a sign that
      // the stored snapshot was taken at a time when canonical costs were
      // under-priced (e.g. missing canonical cost, now resolved).
      const delta = row.unitCost - recomputed
      if (delta > 0) continue // stored >= recompute — expected, modifier overhead
      const absDelta = -delta // stored was lower by this much
      const rowImpact = absDelta * row.qtySold
      if (rowImpact < 0.5) continue
      // Also require a meaningful ratio — 15%+ shortfall suggests stale/missing
      // canonical data, not modifier-related noise.
      const shortfall = absDelta / recomputed
      if (shortfall < 0.15) continue
      const severity = classifyDollarDelta(rowImpact, row.lineCost)
      if (severity === "INFO") continue

      findings.push({
        domain: "cogs-materialization",
        check: "stale_vs_asof",
        severity,
        message: `${store.name} ${row.date.toISOString().slice(0, 10)} "${row.itemName}" — stored ${money(row.unitCost)}/unit vs recompute ${money(recomputed)} (Δ × ${row.qtySold} = ${money(rowImpact)})`,
        entity: { kind: "dailyCogsItem", id: row.id, label: row.itemName },
        details: {
          storeId: store.id,
          date: row.date.toISOString().slice(0, 10),
          stored: row.unitCost,
          recomputed,
          delta,
          qtySold: row.qtySold,
          rowImpact,
          lineCost: row.lineCost,
          recipeId: row.recipeId,
        },
        deltaDollars: rowImpact,
      })
    }
  }

  // ── 3. cogs_without_revenue ────────────────────────────────────────
  const oddRows = await prisma.dailyCogsItem.findMany({
    where: { lineCost: { gt: 0 }, salesRevenue: { lte: 0 } },
    select: { id: true, storeId: true, date: true, itemName: true, qtySold: true, lineCost: true, status: true },
    take: 50,
  })
  for (const row of oddRows) {
    findings.push({
      domain: "cogs-materialization",
      check: "cogs_without_revenue",
      severity: "WARNING",
      message: `${row.date.toISOString().slice(0, 10)} "${row.itemName}" — ${money(row.lineCost)} COGS with $0 revenue (qty ${row.qtySold}, status ${row.status})`,
      entity: { kind: "dailyCogsItem", id: row.id, label: row.itemName },
      details: {
        storeId: row.storeId,
        date: row.date.toISOString().slice(0, 10),
        lineCost: row.lineCost,
        qtySold: row.qtySold,
        status: row.status,
      },
      deltaDollars: row.lineCost,
    })
  }

  return findings
}

if (require.main === module) {
  auditCogsMaterialization()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`cogs-materialization: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
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
