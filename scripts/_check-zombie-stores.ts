// scripts/_check-zombie-stores.ts
// One-shot: see what (if anything) references the two empty placeholder stores.

import fs from "fs"
import path from "path"

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
    result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
  }
  return result
}

const env = loadEnvLocal()
if (!process.env.DATABASE_URL && env["DATABASE_URL"]) process.env.DATABASE_URL = env["DATABASE_URL"]

const ZOMBIE_IDS = ["cmm139bvt0065buu9k17xpte5", "cmexd7ww00001l104pyurgyho"]

async function main(): Promise<void> {
  const { PrismaClient } = await import("../src/generated/prisma/client")
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl: true })
  const prisma = new PrismaClient({ adapter })

  try {
    for (const id of ZOMBIE_IDS) {
      const store = await prisma.store.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true, accountId: true, createdAt: true } })
      console.log(`\n=== Store ${id} ===`)
      console.log(store)

      const counts = {
        otterStores: await prisma.otterStore.count({ where: { storeId: id } }),
        otterDailySummary: await prisma.otterDailySummary.count({ where: { storeId: id } }),
        otterHourlySummary: await prisma.otterHourlySummary.count({ where: { storeId: id } }),
        otterMenuCategory: await prisma.otterMenuCategory.count({ where: { storeId: id } }),
        otterMenuItem: await prisma.otterMenuItem.count({ where: { storeId: id } }),
        otterRating: await prisma.otterRating.count({ where: { storeId: id } }),
        prepTask: await prisma.prepTask.count({ where: { storeId: id } }),
        invoice: await prisma.invoice.count({ where: { storeId: id } }),
        otterItemMapping: await prisma.otterItemMapping.count({ where: { storeId: id } }),
        otterSubItemMapping: await prisma.otterSubItemMapping.count({ where: { storeId: id } }),
        dailyCogsItem: await prisma.dailyCogsItem.count({ where: { storeId: id } }),
        otterOrder: await prisma.otterOrder.count({ where: { storeId: id } }),
        aiForecastRun: await prisma.aiForecastRun.count({ where: { storeId: id } }),
        jobRun: await prisma.jobRun.count({ where: { storeId: id } }),
        aiUsageEvent: await prisma.aiUsageEvent.count({ where: { storeId: id } }),
        errorEvent: await prisma.errorEvent.count({ where: { storeId: id } }),
        chatTurn: await prisma.chatTurn.count({ where: { storeId: id } }),
      }

      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      console.log(`Reference counts (total=${total}):`)
      for (const [k, v] of Object.entries(counts)) {
        if (v > 0) console.log(`  ${k}: ${v}`)
      }
      if (total === 0) console.log("  (no references — safe to delete)")
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
