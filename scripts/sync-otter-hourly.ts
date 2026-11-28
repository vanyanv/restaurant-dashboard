// scripts/sync-otter-hourly.ts
// Hourly precompute job. Run with: npx tsx scripts/sync-otter-hourly.ts
// GH Actions cron (otter-hourly-sync.yml) executes this every hour.

import "../src/lib/usage/script-meter-register" // usage counts; keep first
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

async function main() {
  const { runHourlySync } = await import("../src/lib/hourly-sync")
  const { warnIfNoRedis } = await import("../src/lib/cache/redis")
  warnIfNoRedis("sync-otter-hourly")
  // The workflow passes --skip-if-recent: sync-ticker.yml dispatches this hour
  // on time and the workflow's own backup `schedule:` can fire the same hour
  // again later. A run that finds a SUCCESS in the last 20 minutes prints
  // `{"skipped":"recent-success",...}` and writes nothing.
  const result = await runHourlySync({
    triggeredBy: "github-actions",
    skipIfRecentSuccess: process.argv.includes("--skip-if-recent"),
  })
  console.log("Hourly sync complete:", JSON.stringify(result))
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Hourly sync failed:", err)
    process.exit(1)
  })
