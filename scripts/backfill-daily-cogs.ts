// scripts/backfill-daily-cogs.ts
// One-shot backfill of DailyCogsItem rows for every owner's active stores.
// Idempotent: writes are upserts and the per-day cleanup is bounded to that
// day, so re-running is safe and historical rows from other days are never
// touched.
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
  const { recomputeDailyCogsForRange } = await import("../src/lib/cogs-materializer")

  const lookbackDays = Number.parseInt(process.argv[2] ?? "", 10) || 365

  const owners = await prisma.user.findMany({
    where: { role: "OWNER" },
    select: { id: true, email: true },
  })

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  console.log(
    `Backfilling DailyCogsItem for ${owners.length} owner(s), lookback ${lookbackDays}d ` +
      `(${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)})`
  )

  let totalDays = 0
  let totalUpserted = 0
  let totalDeleted = 0

  for (const owner of owners) {
    const stores = await prisma.store.findMany({
      where: { ownerId: owner.id, isActive: true },
      select: { id: true, name: true },
    })

    for (const store of stores) {
      const start = Date.now()
      try {
        const result = await recomputeDailyCogsForRange({
          storeId: store.id,
          startDate,
          endDate,
          ownerId: owner.id,
        })
        totalDays += result.daysProcessed
        totalUpserted += result.rowsUpserted
        totalDeleted += result.rowsDeleted
        const ms = Date.now() - start
        console.log(
          `  ${owner.email} / ${store.name}: ${result.daysProcessed} day(s), ` +
            `${result.rowsUpserted} upserted, ${result.rowsDeleted} cleaned — ${ms}ms`
        )
      } catch (err) {
        console.error(`  ${owner.email} / ${store.name}: FAILED`, err)
      }
    }
  }

  console.log(
    `Done: ${totalDays} day(s), ${totalUpserted} upserted, ${totalDeleted} cleaned`
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
