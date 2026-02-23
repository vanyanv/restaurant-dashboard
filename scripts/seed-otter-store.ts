// scripts/seed-otter-store.ts
// Run with: npx tsx scripts/seed-otter-store.ts
// Detects which Otter UUID belongs to the Hollywood store and upserts OtterStore in the DB.

import { execSync } from "child_process"
import fs from "fs"
import path from "path"

// ---------------------------------------------------------------------------
// 1. Load .env.local (same pattern as test-otter.ts)
// ---------------------------------------------------------------------------

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

const env = loadEnvLocal()

// Set DATABASE_URL before Prisma client is imported so it picks it up.
if (!process.env.DATABASE_URL && env["DATABASE_URL"]) {
  process.env.DATABASE_URL = env["DATABASE_URL"]
}

const JWT = process.env.OTTER_JWT ?? env["OTTER_JWT"] ?? env["Bearer"]

if (!JWT) {
  console.error("Error: JWT not found. Add OTTER_JWT or Bearer to .env.local")
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL not found. Add DATABASE_URL to .env.local")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

const HOLLYWOOD_STORE_ID = "cmexd4zia0001jr04ljkdt9na"

const STORE_IDS = [
  "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
  "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
  "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
  "3dff7900-1388-4332-8079-091c3bb96eb4",
  "701340d6-eeac-4a61-92ef-3bec103654ea",
  "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
]

const HEADERS = {
  Authorization: `Bearer ${JWT}`,
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

// ---------------------------------------------------------------------------
// 3. Build date range: last 7 days
// ---------------------------------------------------------------------------

const now = new Date()
const sevenDaysAgo = new Date(now)
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
const minDate = sevenDaysAgo.toISOString()
const maxDate = now.toISOString()

// ---------------------------------------------------------------------------
// 4. Types
// ---------------------------------------------------------------------------

interface OtterCell {
  key: string
  value: number | string | null
}

interface OtterResponse {
  rows: OtterCell[][]
  totalRowCount?: number
}

// ---------------------------------------------------------------------------
// 5. Query the Otter API
// ---------------------------------------------------------------------------

async function fetchStoreMetrics(): Promise<OtterResponse> {
  const body = {
    columns: [
      { type: "metric", key: "fp_sales_financials_gross_sales" },
      { type: "metric", key: "third_party_gross_sales" },
    ],
    groupBy: [{ key: "store" }],
    sortBy: [{ type: "metric", key: "fp_sales_financials_gross_sales", sortOrder: "DESC" }],
    filterSet: [{ filterType: "dateRangeFilter", minDate, maxDate }],
    scopeSet: [{ key: "store", values: STORE_IDS }],
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 100,
    includeRawQueries: false,
  }

  console.log(`Querying Otter API...`)
  console.log(`  Date range: ${minDate} → ${maxDate}`)
  console.log(`  Stores queried: ${STORE_IDS.length}`)

  const res = await fetch("https://api.tryotter.com/analytics/table/metrics_explorer", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  })

  console.log(`  Response: ${res.status} ${res.statusText}`)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Otter API error ${res.status}: ${text}`)
  }

  return res.json() as Promise<OtterResponse>
}

// ---------------------------------------------------------------------------
// 6. Parse response and find the active UUID
// ---------------------------------------------------------------------------

function findActiveUUID(data: OtterResponse): string | null {
  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error(`Unexpected API response shape: ${JSON.stringify(data).slice(0, 200)}`)
  }

  console.log(`\nRows returned: ${data.rows.length}`)

  const results: Array<{
    uuid: string
    fpGrossSales: number | null
    tpGrossSales: number | null
    total: number
  }> = []

  for (const row of data.rows) {
    const flat: Record<string, number | string | null> = {}
    for (const cell of row) {
      flat[cell.key] = cell.value
    }

    const uuid = flat["store"] as string | null
    if (!uuid) continue

    const fpGrossSales =
      flat["fp_sales_financials_gross_sales"] != null
        ? Number(flat["fp_sales_financials_gross_sales"])
        : null

    const tpGrossSales =
      flat["third_party_gross_sales"] != null
        ? Number(flat["third_party_gross_sales"])
        : null

    const total = (fpGrossSales ?? 0) + (tpGrossSales ?? 0)

    results.push({ uuid, fpGrossSales, tpGrossSales, total })
  }

  // Print summary table
  console.log("\nPer-UUID sales summary (last 7 days):")
  console.log("  UUID                                     | FP Gross Sales | 3P Gross Sales | Total")
  console.log("  " + "-".repeat(90))
  for (const r of results) {
    const fp = r.fpGrossSales != null ? `$${r.fpGrossSales.toFixed(2)}` : "null"
    const tp = r.tpGrossSales != null ? `$${r.tpGrossSales.toFixed(2)}` : "null"
    const total = `$${r.total.toFixed(2)}`
    console.log(`  ${r.uuid} | ${fp.padStart(14)} | ${tp.padStart(14)} | ${total.padStart(10)}`)
  }

  // Find the UUID with the highest non-zero total sales (most activity = real store)
  const activeCandidates = results.filter((r) => r.total > 0)
  if (activeCandidates.length > 1) {
    console.warn(`\nWARNING: ${activeCandidates.length} UUIDs have non-zero sales.`)
    console.warn("Seeding the highest-revenue UUID — verify this is the correct Hollywood location.")
    console.warn("Candidates:", activeCandidates.map(r => `${r.uuid}: $${r.total.toFixed(2)}`).join(", "))
  }
  const active = activeCandidates.sort((a, b) => b.total - a.total)[0]

  if (!active) {
    console.log("\nNo UUID had non-zero sales in the last 7 days.")
    return null
  }

  if (!STORE_IDS.includes(active.uuid)) {
    console.error(`ERROR: Detected UUID ${active.uuid} is not in the known STORE_IDS list.`)
    process.exit(1)
  }

  console.log(`\nDetected active Otter UUID: ${active.uuid}`)
  console.log(`  FP Gross Sales: ${active.fpGrossSales != null ? `$${active.fpGrossSales.toFixed(2)}` : "null"}`)
  console.log(`  3P Gross Sales: ${active.tpGrossSales != null ? `$${active.tpGrossSales.toFixed(2)}` : "null"}`)
  console.log(`  Total:          $${active.total.toFixed(2)}`)

  return active.uuid
}

// ---------------------------------------------------------------------------
// 7. Upsert OtterStore in the database
// ---------------------------------------------------------------------------

async function upsertOtterStore(detectedUUID: string): Promise<void> {
  // Regenerate Prisma client WITH the local engine (overrides --no-engine from postinstall)
  console.log("\nRegenerating Prisma client with local engine...")
  execSync("npx prisma generate", { stdio: "inherit" })

  // Dynamic import after DATABASE_URL is set
  const { PrismaClient } = await import("../src/generated/prisma/client")
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl: true })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log(`\nUpserting OtterStore record...`)
    console.log(`  storeId:      ${HOLLYWOOD_STORE_ID}`)
    console.log(`  otterStoreId: ${detectedUUID}`)

    const record = await prisma.otterStore.upsert({
      where: { otterStoreId: detectedUUID },
      create: { storeId: HOLLYWOOD_STORE_ID, otterStoreId: detectedUUID },
      update: { storeId: HOLLYWOOD_STORE_ID },
    })

    console.log("\nOtterStore upserted successfully:")
    console.log(`  id:           ${record.id}`)
    console.log(`  storeId:      ${record.storeId}`)
    console.log(`  otterStoreId: ${record.otterStoreId}`)
    console.log(`  createdAt:    ${record.createdAt.toISOString()}`)
  } finally {
    await prisma.$disconnect()
  }
}

// ---------------------------------------------------------------------------
// 8. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60))
  console.log("seed-otter-store: Detect Hollywood Otter UUID and upsert DB")
  console.log("=".repeat(60))

  const data = await fetchStoreMetrics()
  const detectedUUID = findActiveUUID(data)

  if (!detectedUUID) {
    console.error(
      "\nError: Could not detect a UUID with sales activity in the last 7 days.\n" +
        "Possible causes:\n" +
        "  - The date range has no data (try a different range)\n" +
        "  - The JWT is expired or scoped to different stores\n" +
        "  - All stores had $0 sales (unusual)\n"
    )
    process.exit(1)
  }

  await upsertOtterStore(detectedUUID)

  console.log("\nDone.")
}

main().catch((err) => {
  console.error("\nFatal error:", err)
  process.exit(1)
})
