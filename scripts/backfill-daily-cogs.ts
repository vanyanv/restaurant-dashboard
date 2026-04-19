// scripts/backfill-daily-cogs.ts
// One-time backfill of DailyCogsItem rows for every owner's active stores.
// Idempotent: re-running is safe — it only fills days that have OtterMenuItem
// rows but no DailyCogsItem rows yet.
//
// Run with: npx tsx scripts/backfill-daily-cogs.ts [lookbackDays]
//   npx tsx scripts/backfill-daily-cogs.ts           # 365 days (default)
//   npx tsx scripts/backfill-daily-cogs.ts 90        # 90 days

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
  const { prisma } = await import("../src/lib/prisma")
  const { refreshStaleDailyCogs } = await import("../src/lib/cogs-materializer")

  const lookbackDays = Number.parseInt(process.argv[2] ?? "", 10) || 365

  const owners = await prisma.user.findMany({
    where: { role: "OWNER" },
    select: { id: true, email: true },
  })

  console.log(`Backfilling DailyCogsItem for ${owners.length} owner(s), lookback ${lookbackDays}d`)

  let totalDays = 0
  let totalRows = 0

  for (const owner of owners) {
    const start = Date.now()
    try {
      const { daysProcessed, rowsWritten } = await refreshStaleDailyCogs({
        ownerId: owner.id,
        lookbackDays,
      })
      totalDays += daysProcessed
      totalRows += rowsWritten
      const ms = Date.now() - start
      console.log(
        `  ${owner.email}: ${daysProcessed} day(s), ${rowsWritten} row(s) — ${ms}ms`
      )
    } catch (err) {
      console.error(`  ${owner.email}: FAILED`, err)
    }
  }

  console.log(`Done: ${totalDays} day(s), ${totalRows} row(s)`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
