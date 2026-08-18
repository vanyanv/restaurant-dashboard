// scripts/backfill-harri-schedule.ts
// Backfill HarriShift from Harri's scheduling service.
//
//   npx tsx scripts/backfill-harri-schedule.ts --store=<storeId> --weeks=52
//   npx tsx scripts/backfill-harri-schedule.ts --store=<storeId> --start=2025-02-17
//
// One HTTP call per ISO week (the endpoint is week-addressable only), so a
// year is 52 calls. Idempotent — each week is replaced wholesale.

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

function parseArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

async function main() {
  const { runHarriScheduleSync } = await import("../src/lib/harri-schedule-sync")

  const storeId = parseArg("store")
  if (!storeId) {
    console.error("Usage: npx tsx scripts/backfill-harri-schedule.ts --store=<storeId> [--weeks=52 | --start=YYYY-MM-DD]")
    process.exit(1)
  }

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)

  const startArg = parseArg("start")
  const startDate = startArg
    ? new Date(`${startArg}T00:00:00.000Z`)
    : (() => {
        const weeks = parseInt(parseArg("weeks") || "52", 10)
        const d = new Date(endDate)
        d.setUTCDate(d.getUTCDate() - weeks * 7)
        return d
      })()

  console.log(
    `\nHarri schedule backfill — ${startDate.toISOString().slice(0, 10)} .. ${endDate
      .toISOString()
      .slice(0, 10)}\n`
  )

  const result = await runHarriScheduleSync({
    storeId,
    startDate,
    endDate,
    triggeredBy: "manual",
  })

  console.log("done:", JSON.stringify(result, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
