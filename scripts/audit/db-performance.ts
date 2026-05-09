/**
 * Read-only DB / query performance audit.
 *
 * Usage:
 *   npx tsx scripts/audit/db-performance.ts [--runs 12]
 *
 * Notes:
 *   - Strictly read-only; performs no DDL / DML.
 *   - --runs is clamped to [10, 15] (default 12) so timings are stable
 *     without becoming punishing on the production DB.
 *   - Output is markdown on stdout, suitable for piping into a report.
 */

import { prisma } from "@/lib/prisma"

type Args = { runs: number }

function parseArgs(argv: string[]): Args {
  let runs = 12
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs") {
      const v = Number(argv[i + 1])
      if (Number.isFinite(v)) runs = Math.max(10, Math.min(15, Math.round(v)))
      i++
    }
  }
  return { runs }
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  )
  return sorted[idx]
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

async function timeOnce<T>(fn: () => Promise<T>): Promise<number> {
  const t0 = process.hrtime.bigint()
  await fn()
  const t1 = process.hrtime.bigint()
  return Number(t1 - t0) / 1e6 // ms
}

async function timeRepeated<T>(
  label: string,
  runs: number,
  fn: () => Promise<T>
): Promise<{ label: string; runs: number[]; avg: number; p50: number; p90: number; max: number }> {
  // First call is a warm-up to populate plan/buffer cache.
  await fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    samples.push(await timeOnce(fn))
  }
  return {
    label,
    runs: samples,
    avg: avg(samples),
    p50: pct(samples, 50),
    p90: pct(samples, 90),
    max: Math.max(...samples),
  }
}

type Bench = Awaited<ReturnType<typeof timeRepeated>>

function fmtMs(n: number): string {
  return `${n.toFixed(1)} ms`
}

function renderBenchTable(rows: Bench[]): string {
  const header = "| Workload | avg | p50 | p90 | max |\n|---|---:|---:|---:|---:|"
  const body = rows
    .map((r) => `| ${r.label} | ${fmtMs(r.avg)} | ${fmtMs(r.p50)} | ${fmtMs(r.p90)} | ${fmtMs(r.max)} |`)
    .join("\n")
  return `${header}\n${body}`
}

async function topTables(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{
      relname: string
      live_tuples: bigint
      total_size: string
      table_size: string
      indexes_size: string
    }>
  >`
    SELECT
      c.relname,
      s.n_live_tup AS live_tuples,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
      pg_size_pretty(pg_relation_size(c.oid))       AS table_size,
      pg_size_pretty(pg_indexes_size(c.oid))        AS indexes_size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 15
  `
  const header =
    "| Table | Live rows | Total | Table | Indexes |\n|---|---:|---:|---:|---:|"
  const body = rows
    .map(
      (r) =>
        `| ${r.relname} | ${r.live_tuples?.toString() ?? "—"} | ${r.total_size} | ${r.table_size} | ${r.indexes_size} |`
    )
    .join("\n")
  return `${header}\n${body}`
}

async function seqScanStats(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{
      relname: string
      seq_scan: bigint
      idx_scan: bigint
      seq_tup_read: bigint
      n_live_tup: bigint
    }>
  >`
    SELECT
      relname,
      seq_scan,
      idx_scan,
      seq_tup_read,
      n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND seq_scan > 0
    ORDER BY seq_tup_read DESC
    LIMIT 10
  `
  const header =
    "| Table | seq_scans | idx_scans | seq_tup_read | live_tup |\n|---|---:|---:|---:|---:|"
  const body = rows
    .map(
      (r) =>
        `| ${r.relname} | ${r.seq_scan} | ${r.idx_scan} | ${r.seq_tup_read} | ${r.n_live_tup} |`
    )
    .join("\n")
  return `${header}\n${body}`
}

async function pgStatStatementsAvailable(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) AS exists
  `
  return Boolean(rows[0]?.exists)
}

/* ----------------------------- workload defs ----------------------------- */

async function bench_subitemsCatalog(): Promise<Bench[]> {
  const stores = await prisma.store.findMany({ select: { id: true } })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 90)

  // The new SQL the action runs (DB-side aggregation).
  const newPath = () =>
    prisma.$queryRaw`
      WITH per_combo AS (
        SELECT
          s."skuId" AS sku_id, s.name AS name, s."subHeader" AS sub_header,
          o."storeId" AS store_id,
          SUM(COALESCE(s.quantity, 1) * COALESCE(i.quantity, 1)) AS uses,
          MIN(o."referenceTimeLocal") AS first_seen,
          MAX(o."referenceTimeLocal") AS last_seen
        FROM "OtterOrderSubItem" s
        JOIN "OtterOrderItem" i ON i.id = s."orderItemId"
        JOIN "OtterOrder" o     ON o.id = i."orderId"
        WHERE o."storeId" = ANY(${storeIds}::text[])
          AND s."skuId" IS NOT NULL
          AND o."referenceTimeLocal" >= ${sinceDate}::timestamp
        GROUP BY 1, 2, 3, 4
      ),
      name_votes AS (
        SELECT sku_id, name, SUM(uses) AS uses FROM per_combo GROUP BY 1, 2
      ),
      header_votes AS (
        SELECT sku_id, sub_header, SUM(uses) AS uses FROM per_combo GROUP BY 1, 2
      ),
      top_name AS (
        SELECT DISTINCT ON (sku_id) sku_id, name FROM name_votes
        ORDER BY sku_id, uses DESC, name
      ),
      top_header AS (
        SELECT DISTINCT ON (sku_id) sku_id, sub_header FROM header_votes
        ORDER BY sku_id, uses DESC, sub_header NULLS LAST
      ),
      totals AS (
        SELECT sku_id,
               SUM(uses) AS occurrences,
               MIN(first_seen) AS first_seen,
               MAX(last_seen)  AS last_seen,
               array_agg(DISTINCT store_id) AS store_ids
        FROM per_combo GROUP BY 1
      )
      SELECT t.sku_id, t.occurrences, tn.name, th.sub_header,
             t.first_seen, t.last_seen, t.store_ids
      FROM totals t
      JOIN top_name tn   ON tn.sku_id = t.sku_id
      JOIN top_header th ON th.sku_id = t.sku_id
      ORDER BY t.occurrences DESC
    `

  // Approximation of the previous nested-fetch path: same join, no aggregate.
  // We LIMIT to keep the audit safe on very large datasets.
  const oldPath = () =>
    prisma.$queryRaw`
      SELECT s."skuId", s.name, s."subHeader", s.quantity AS sub_qty,
             i.quantity AS parent_qty,
             o."storeId", o."referenceTimeLocal"
      FROM "OtterOrderSubItem" s
      JOIN "OtterOrderItem" i ON i.id = s."orderItemId"
      JOIN "OtterOrder" o     ON o.id = i."orderId"
      WHERE o."storeId" = ANY(${storeIds}::text[])
        AND o."referenceTimeLocal" >= ${sinceDate}::timestamp
      LIMIT 200000
    `

  return [
    await timeRepeated("getOtterSubItemsForCatalog (NEW: SQL aggregate, 90d)", 12, newPath),
    await timeRepeated("getOtterSubItemsForCatalog (OLD: nested rows, 90d, limit 200k)", 12, oldPath),
  ]
}

async function bench_menuCatalog(runs: number): Promise<Bench> {
  const stores = await prisma.store.findMany({ select: { id: true } })
  const storeIds = stores.map((s) => s.id)
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 90)

  return timeRepeated("menu items catalog (90d aggregate)", runs, () =>
    prisma.$queryRaw`
      SELECT i."skuId", i.name,
             SUM(COALESCE(i.quantity, 1)) AS qty,
             MIN(o."referenceTimeLocal")  AS first_seen,
             MAX(o."referenceTimeLocal")  AS last_seen
      FROM "OtterOrderItem" i
      JOIN "OtterOrder" o ON o.id = i."orderId"
      WHERE o."storeId" = ANY(${storeIds}::text[])
        AND o."referenceTimeLocal" >= ${sinceDate}::timestamp
      GROUP BY 1, 2
      ORDER BY qty DESC
    `
  )
}

async function bench_dailyCogs(runs: number): Promise<Bench> {
  const stores = await prisma.store.findMany({ select: { id: true } })
  const storeIds = stores.map((s) => s.id)
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 90)
  return timeRepeated("daily COGS (90d, all stores)", runs, () =>
    prisma.$queryRaw`
      SELECT "storeId", date,
             SUM("salesRevenue") AS revenue,
             SUM("lineCost")      AS cost
      FROM "DailyCogsItem"
      WHERE "storeId" = ANY(${storeIds}::text[])
        AND date >= ${sinceDate}::date
      GROUP BY 1, 2
    `
  )
}

async function bench_invoiceSummary(runs: number): Promise<Bench> {
  return timeRepeated("invoice summary (last 90d)", runs, async () => {
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - 90)
    return prisma.invoice.findMany({
      where: { invoiceDate: { gte: sinceDate } },
      select: { id: true, total: true, vendorName: true, invoiceDate: true },
      take: 5000,
    })
  })
}

async function bench_packagingAvoidedCost(runs: number): Promise<Bench[]> {
  const stores = await prisma.store.findMany({ select: { id: true } })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 30)
  const endDate = new Date()

  // NEW: SQL pre-groups by basket signature; only unique baskets returned.
  const newPath = () =>
    prisma.$queryRaw`
      WITH dine_in_orders AS (
        SELECT o.id, o."fulfillmentMode"
        FROM "OtterOrder" o
        WHERE o."storeId" = ANY(${storeIds}::text[])
          AND o."referenceTimeLocal" >= ${sinceDate}::timestamp
          AND o."referenceTimeLocal" <= ${endDate}::timestamp
          AND (o."fulfillmentMode" ILIKE '%dine_in%' OR o."fulfillmentMode" ILIKE '%dine in%')
      ),
      item_subitems AS (
        SELECT
          i.id, i."orderId", i.name, i.quantity,
          (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('name', s.name, 'quantity', s.quantity, 'subHeader', s."subHeader")
                            ORDER BY s.name, s.quantity, COALESCE(s."subHeader", '')), '[]'::jsonb)
            FROM "OtterOrderSubItem" s WHERE s."orderItemId" = i.id
          ) AS sub_items
        FROM "OtterOrderItem" i WHERE i."orderId" IN (SELECT id FROM dine_in_orders)
      ),
      order_baskets AS (
        SELECT "orderId",
               jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'subItems', sub_items)
                         ORDER BY name, quantity) AS items
        FROM item_subitems GROUP BY "orderId"
      )
      SELECT d."fulfillmentMode", ob.items, COUNT(*) AS occurrences
      FROM dine_in_orders d JOIN order_baskets ob ON ob."orderId" = d.id
      GROUP BY d."fulfillmentMode", ob.items
    `

  // OLD: every dine-in order + nested items + subItems materialized in JS.
  const oldPath = () =>
    prisma.$queryRaw`
      SELECT o.id, o."fulfillmentMode",
             i.name AS item_name, i.quantity AS item_qty,
             s.name AS sub_name, s.quantity AS sub_qty, s."subHeader"
      FROM "OtterOrder" o
      JOIN "OtterOrderItem" i ON i."orderId" = o.id
      LEFT JOIN "OtterOrderSubItem" s ON s."orderItemId" = i.id
      WHERE o."storeId" = ANY(${storeIds}::text[])
        AND o."referenceTimeLocal" >= ${sinceDate}::timestamp
        AND o."referenceTimeLocal" <= ${endDate}::timestamp
        AND (o."fulfillmentMode" ILIKE '%dine_in%' OR o."fulfillmentMode" ILIKE '%dine in%')
    `

  return [
    await timeRepeated("packaging avoided-cost (NEW: SQL signature aggregate, 30d)", runs, newPath),
    await timeRepeated("packaging avoided-cost (OLD: raw rows, 30d)", runs, oldPath),
  ]
}

async function bench_productAnalytics(runs: number): Promise<Bench> {
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 90)
  return timeRepeated("product analytics (NEW: SQL groupBy, 90d)", runs, () =>
    prisma.$queryRaw`
      SELECT
        li."productName",
        (array_remove(array_agg(li.sku ORDER BY li.sku), NULL))[1] AS sku,
        SUM(li.quantity)::float AS total_quantity,
        SUM(li."extendedPrice")::float AS total_spend,
        COUNT(DISTINCT li."invoiceId") AS invoice_count
      FROM "InvoiceLineItem" li
      JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE i."invoiceDate" >= ${sinceDate}::timestamp
      GROUP BY li."productName"
      ORDER BY SUM(li."extendedPrice") DESC
      LIMIT 200
    `
  )
}

/* ------------------------------- main ------------------------------- */

async function main() {
  const { runs } = parseArgs(process.argv.slice(2))

  console.log(`# DB Performance Audit\n`)
  console.log(`Runs per workload: **${runs}** (warm-up call excluded)`)
  console.log(`Timestamp: ${new Date().toISOString()}\n`)

  console.log(`## Top tables by total size\n`)
  console.log(await topTables())
  console.log(``)

  console.log(`## Sequential-scan hotspots\n`)
  console.log(await seqScanStats())
  console.log(``)

  const hasPgss = await pgStatStatementsAvailable()
  console.log(`## pg_stat_statements\n`)
  console.log(
    hasPgss
      ? `Extension installed — use \`pg_stat_statements\` for live query stats.`
      : `**Not installed.** Treat enabling it as an infra/DBA follow-up.`
  )
  console.log(``)

  console.log(`## Subitem catalog (the bottleneck this audit targeted)\n`)
  const subitemBenches = await bench_subitemsCatalog()
  if (subitemBenches.length === 0) {
    console.log(`_No stores found — skipping._\n`)
  } else {
    console.log(renderBenchTable(subitemBenches))
    console.log(``)
  }

  console.log(`## Round-2 hotspots\n`)
  const r2: Bench[] = []
  r2.push(...(await bench_packagingAvoidedCost(runs)))
  r2.push(await bench_productAnalytics(runs))
  if (r2.length > 0) {
    console.log(renderBenchTable(r2))
    console.log(``)
  } else {
    console.log(`_No stores found — skipping._\n`)
  }

  console.log(`## Other read paths\n`)
  const others: Bench[] = []
  others.push(await bench_menuCatalog(runs))
  others.push(await bench_dailyCogs(runs))
  others.push(await bench_invoiceSummary(runs))
  console.log(renderBenchTable(others))
  console.log(``)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
