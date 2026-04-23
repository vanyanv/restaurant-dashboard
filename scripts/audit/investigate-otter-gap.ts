// Group B investigation: why does Σ OtterOrder.subtotal diverge from
// OtterDailySummary.(fpGrossSales + tpGrossSales) every day?
//
// Hypotheses to test:
//   H1. Summary lags orders (missing today/yesterday because sync hasn't run).
//   H2. Summary and orders use different day boundaries (UTC vs local).
//   H3. Summary EXCLUDES a platform that orders INCLUDES (or vice-versa).
//   H4. Summary uses gross (pre-tax, pre-tip) while orders.subtotal is something
//       different (post-discount? net sales?).
//   H5. Some orders are CANCELLED but still in OtterOrder.
//
// Output: a per-day breakdown and a by-platform breakdown so we can see which
// hypothesis fits.

import { loadEnvLocal, money } from "./lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../../src/lib/prisma")

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })
  const hollywood = stores.find((s) => s.name.toLowerCase().includes("hollywood"))
  if (!hollywood) {
    console.log("Hollywood store not found")
    await prisma.$disconnect()
    return
  }
  console.log(`Store: ${hollywood.name} (${hollywood.id})`)

  // H1: Summary lag check — latest summary date vs latest order date.
  const latestSummary = await prisma.otterDailySummary.findFirst({
    where: { storeId: hollywood.id },
    orderBy: { date: "desc" },
    select: { date: true },
  })
  const latestOrder = await prisma.otterOrder.findFirst({
    where: { storeId: hollywood.id },
    orderBy: { referenceTimeLocal: "desc" },
    select: { referenceTimeLocal: true },
  })
  console.log(`\nH1 — sync-lag check:`)
  console.log(`  latest OtterDailySummary.date      : ${latestSummary?.date.toISOString().slice(0, 10)}`)
  console.log(`  latest OtterOrder.referenceTimeLocal: ${latestOrder?.referenceTimeLocal.toISOString().slice(0, 16)}`)

  // H2 + by-platform — per-day, per-platform breakdown for the last 21 days.
  console.log(`\nH2 + H3 — daily gap, broken down by platform (last 21 days):`)
  const rows = await prisma.$queryRaw<Array<{ day: Date; order_subtotal: number; summary_gross: number; order_count: bigint }>>`
    WITH d AS (
      SELECT generate_series(
        (CURRENT_DATE - INTERVAL '20 days')::date,
        CURRENT_DATE::date,
        '1 day'::interval
      )::date AS day
    )
    SELECT d.day,
           COALESCE((
             SELECT SUM("subtotal")::float
             FROM "OtterOrder"
             WHERE "storeId" = ${hollywood.id}
               AND date_trunc('day', "referenceTimeLocal")::date = d.day
           ), 0) AS "order_subtotal",
           COALESCE((
             SELECT SUM(COALESCE("fpGrossSales",0) + COALESCE("tpGrossSales",0))::float
             FROM "OtterDailySummary"
             WHERE "storeId" = ${hollywood.id}
               AND "date" = d.day
           ), 0) AS "summary_gross",
           COALESCE((
             SELECT COUNT(*)
             FROM "OtterOrder"
             WHERE "storeId" = ${hollywood.id}
               AND date_trunc('day', "referenceTimeLocal")::date = d.day
           ), 0) AS "order_count"
    FROM d
    ORDER BY d.day DESC
  `
  console.log(`  ${"day".padEnd(12)}${"Σ orders".padStart(12)}${"summary".padStart(12)}${"Δ".padStart(12)}  orders`)
  for (const r of rows) {
    const delta = r.order_subtotal - r.summary_gross
    console.log(
      `  ${r.day.toISOString().slice(0, 10).padEnd(12)}` +
      `${money(r.order_subtotal).padStart(12)}` +
      `${money(r.summary_gross).padStart(12)}` +
      `${money(delta).padStart(12)}` +
      `  ${Number(r.order_count)}`
    )
  }

  // H3 — platform split for a recent day that HAS a gap.
  // Pick the most recent day where abs delta > 0.
  const gapDay = rows.find((r) => Math.abs(r.order_subtotal - r.summary_gross) > 1 && r.order_subtotal > 0 && r.summary_gross > 0)
  if (gapDay) {
    console.log(`\nH3 — platform breakdown for ${gapDay.day.toISOString().slice(0, 10)}:`)
    const byOrdersPlat = await prisma.$queryRaw<Array<{ platform: string; sub: number; cnt: bigint }>>`
      SELECT "platform",
             SUM("subtotal")::float AS "sub",
             COUNT(*) AS "cnt"
      FROM "OtterOrder"
      WHERE "storeId" = ${hollywood.id}
        AND date_trunc('day', "referenceTimeLocal")::date = ${gapDay.day}
      GROUP BY "platform"
      ORDER BY SUM("subtotal") DESC
    `
    console.log(`  OtterOrder by platform:`)
    for (const p of byOrdersPlat) console.log(`    ${p.platform.padEnd(14)} ${money(p.sub).padStart(12)}  ${Number(p.cnt)} orders`)

    const bySummaryPlat = await prisma.$queryRaw<Array<{ platform: string; fp: number; tp: number }>>`
      SELECT "platform",
             SUM(COALESCE("fpGrossSales",0))::float AS "fp",
             SUM(COALESCE("tpGrossSales",0))::float AS "tp"
      FROM "OtterDailySummary"
      WHERE "storeId" = ${hollywood.id}
        AND "date" = ${gapDay.day}
      GROUP BY "platform"
      ORDER BY (SUM(COALESCE("fpGrossSales",0)) + SUM(COALESCE("tpGrossSales",0))) DESC
    `
    console.log(`  OtterDailySummary by platform:`)
    for (const p of bySummaryPlat) console.log(`    ${p.platform.padEnd(14)} fp=${money(p.fp).padStart(10)}  tp=${money(p.tp).padStart(10)}`)
  }

  // H4 — compare order.subtotal vs order.total for sanity. Summary reports "gross sales"
  // which is supposed to be pre-tax, pre-tip, post-discount.
  console.log(`\nH4 — order.subtotal vs derived (total - tax - tip) for most recent 3 days:`)
  const recentDaysWithOrders = [...rows].filter((r) => Number(r.order_count) > 0).slice(0, 3)
  for (const r of recentDaysWithOrders) {
    const agg = await prisma.$queryRaw<Array<{ sub: number; tot: number; tax: number; tip: number; cmsn: number; disc: number }>>`
      SELECT SUM("subtotal")::float AS "sub",
             SUM("total")::float AS "tot",
             SUM("tax")::float AS "tax",
             SUM("tip")::float AS "tip",
             SUM("commission")::float AS "cmsn",
             SUM("discount")::float AS "disc"
      FROM "OtterOrder"
      WHERE "storeId" = ${hollywood.id}
        AND date_trunc('day', "referenceTimeLocal")::date = ${r.day}
    `
    const a = agg[0]
    if (!a) continue
    const derived = a.tot - a.tax - a.tip
    console.log(
      `  ${r.day.toISOString().slice(0, 10)}: subtotal=${money(a.sub)}  ` +
      `total=${money(a.tot)}  tax=${money(a.tax)}  tip=${money(a.tip)}  ` +
      `discount=${money(a.disc)}  commission=${money(a.cmsn)}  ` +
      `(total-tax-tip)=${money(derived)}`
    )
  }

  // H5 — orderStatus / acceptanceStatus distribution (cancelled?).
  console.log(`\nH5 — order status distribution (last 30 days):`)
  const statusAgg = await prisma.$queryRaw<Array<{ orderStatus: string | null; acceptanceStatus: string | null; cnt: bigint; sub: number }>>`
    SELECT "orderStatus",
           "acceptanceStatus",
           COUNT(*) AS "cnt",
           SUM("subtotal")::float AS "sub"
    FROM "OtterOrder"
    WHERE "storeId" = ${hollywood.id}
      AND "referenceTimeLocal" >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY "orderStatus", "acceptanceStatus"
    ORDER BY COUNT(*) DESC
  `
  for (const s of statusAgg) {
    console.log(`  orderStatus=${(s.orderStatus ?? "null").padEnd(14)} acceptanceStatus=${(s.acceptanceStatus ?? "null").padEnd(14)} count=${Number(s.cnt)}  subSum=${money(s.sub)}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
