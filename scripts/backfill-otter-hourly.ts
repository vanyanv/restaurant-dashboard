// scripts/backfill-otter-hourly.ts
// One-shot backfill of OtterHourlySummary for the past N days.
//   npx tsx scripts/backfill-otter-hourly.ts            # default 60 days
//   npx tsx scripts/backfill-otter-hourly.ts 90         # 90 days
// Idempotent — uses delete+insert per (storeId, date) inside runHourlySync.
//
// Walks the range in CHUNK_DAYS slices. queryOtterEndpoint reads one response
// page, so `limit` is a hard cap: a single 175-day call returned exactly 50,000
// rows against 58,543 real orders (and 120,000 got a 413 back). Chunking keeps
// every call far under that cap; runHourlySync now throws rather than writing a
// truncated window, so a too-large chunk fails loudly instead of quietly
// under-counting.

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}

loadEnvLocal()

const ROW_LIMIT = 25000
const CHUNK_DAYS = 30

/** Subtract n days from an LA "YYYY-MM-DD" date string. */
function minusDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00.000Z")
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const { runHourlySync } = await import("../src/lib/hourly-sync")
  const { todayInLA } = await import("../src/lib/dashboard-utils")

  const days = parseInt(process.argv[2] || "60", 10)
  if (isNaN(days) || days < 1) {
    console.error("Usage: npx tsx scripts/backfill-otter-hourly.ts [days]")
    process.exit(1)
  }

  const today = todayInLA()
  console.log(
    `\nOtter Hourly Backfill — ${days} days ending ${today} ` +
      `(${Math.ceil(days / CHUNK_DAYS)} chunks of up to ${CHUNK_DAYS})\n`
  )

  let totalRows = 0
  let totalBuckets = 0
  let earliest = ""
  let latest = ""
  let remaining = days
  let offset = 0

  while (remaining > 0) {
    const windowDays = Math.min(CHUNK_DAYS, remaining)
    const anchorDate = minusDays(today, offset)

    const result = await runHourlySync({
      windowDays,
      rowLimit: ROW_LIMIT,
      anchorDate,
      triggeredBy: "manual",
      metadata: { backfill: true, chunkAnchor: anchorDate },
    })

    const first = result.datesCovered[0]
    const last = result.datesCovered[result.datesCovered.length - 1]
    console.log(
      `  ${first} .. ${last}  rows=${String(result.rowsFetched).padStart(6)} ` +
        `buckets=${String(result.bucketsWritten).padStart(5)}`
    )

    totalRows += result.rowsFetched
    totalBuckets += result.bucketsWritten
    if (!latest) latest = last
    earliest = first

    offset += windowDays
    remaining -= windowDays
  }

  console.log(`\nBackfill complete:`)
  console.log(`  Otter rows fetched:     ${totalRows}`)
  console.log(`  Hourly buckets written: ${totalBuckets}`)
  console.log(`  Range: ${earliest} .. ${latest} (${days} days)`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
