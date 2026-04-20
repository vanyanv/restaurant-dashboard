// Delete DailyCogsItem rows within a lookback window for every owner's active
// stores. Used after bulk mapping/recipe changes that bypassed the
// invalidateDailyCogs hooks in action wrappers. Pair with backfill-daily-cogs.ts
// (which calls refreshStaleDailyCogs) to rematerialize the same window.
//
// Run with: npx tsx scripts/invalidate-cogs-window.ts [lookbackDays]
//   npx tsx scripts/invalidate-cogs-window.ts            # 90 days
//   npx tsx scripts/invalidate-cogs-window.ts 30         # 30 days

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const lookbackDays = Number.parseInt(process.argv[2] ?? "", 10) || 90

  const cutoff = new Date()
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays)

  const owners = await prisma.user.findMany({ where: { role: "OWNER" }, select: { id: true, email: true } })

  let totalDeleted = 0
  for (const owner of owners) {
    const stores = await prisma.store.findMany({
      where: { ownerId: owner.id, isActive: true },
      select: { id: true, name: true },
    })
    if (stores.length === 0) continue
    const storeIds = stores.map((s) => s.id)
    const { count } = await prisma.dailyCogsItem.deleteMany({
      where: { storeId: { in: storeIds }, date: { gte: cutoff } },
    })
    totalDeleted += count
    console.log(`  ${owner.email}: deleted ${count} DailyCogsItem rows across ${stores.length} store(s), since ${cutoff.toISOString().slice(0, 10)}`)
  }
  console.log(`\nTotal deleted: ${totalDeleted}`)
  console.log(`Next step: npx tsx scripts/backfill-daily-cogs.ts ${lookbackDays}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
