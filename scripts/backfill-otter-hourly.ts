// scripts/backfill-otter-hourly.ts
// One-shot backfill of OtterHourlySummary for the past N days.
//   npx tsx scripts/backfill-otter-hourly.ts            # default 60 days
//   npx tsx scripts/backfill-otter-hourly.ts 90         # 90 days
// Idempotent — uses delete+insert per (storeId, date) inside runHourlySync.

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

const ROW_LIMIT = 50000

async function main() {
  const { runHourlySync } = await import("../src/lib/hourly-sync")

  const days = parseInt(process.argv[2] || "60", 10)
  if (isNaN(days) || days < 1) {
    console.error("Usage: npx tsx scripts/backfill-otter-hourly.ts [days]")
    process.exit(1)
  }

  console.log(`\nOtter Hourly Backfill — ${days} days\n`)

  const result = await runHourlySync({ windowDays: days, rowLimit: ROW_LIMIT })

  console.log(`\nBackfill complete:`)
  console.log(`  Stores processed:       ${result.storesProcessed}`)
  console.log(`  Otter rows fetched:     ${result.rowsFetched}`)
  console.log(`  Hourly buckets written: ${result.bucketsWritten}`)
  console.log(`  Dates covered: ${result.datesCovered.length} days`)
  console.log(`    earliest: ${result.datesCovered[0]}`)
  console.log(`    latest:   ${result.datesCovered[result.datesCovered.length - 1]}`)

  if (result.rowsFetched >= ROW_LIMIT) {
    console.warn(
      `\n⚠  Hit row limit (${ROW_LIMIT}). Backfill may be incomplete — re-run with smaller windows.`
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
