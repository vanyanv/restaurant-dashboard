// scripts/_migrate-zombie-stores.ts
// One-shot: move OtterItemMapping + OtterSubItemMapping from the empty placeholder
// Store rows onto the canonical Store rows, then delete the placeholders.
// Idempotent — re-running is a no-op once the placeholders are gone.

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

const MIGRATIONS = [
  { from: "cmexd7ww00001l104pyurgyho", to: "store-chrisneddys-vannuys",  label: "Van Nuys" },
  { from: "cmm139bvt0065buu9k17xpte5", to: "store-chrisneddys-glendale", label: "Glendale" },
]

async function main(): Promise<void> {
  const { PrismaClient } = await import("../src/generated/prisma/client")
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl: true })
  const prisma = new PrismaClient({ adapter })

  try {
    for (const { from, to, label } of MIGRATIONS) {
      console.log(`\n=== ${label} ===`)
      console.log(`  from (zombie):    ${from}`)
      console.log(`  to (canonical):   ${to}`)

      const zombie = await prisma.store.findUnique({ where: { id: from } })
      if (!zombie) {
        console.log(`  zombie not found — skipping (already migrated?)`)
        continue
      }

      const canonical = await prisma.store.findUnique({ where: { id: to } })
      if (!canonical) {
        throw new Error(`Canonical store ${to} not found. Run seed-new-stores.ts first.`)
      }

      const itemBefore = await prisma.otterItemMapping.count({ where: { storeId: from } })
      const subBefore = await prisma.otterSubItemMapping.count({ where: { storeId: from } })
      console.log(`  before: itemMappings=${itemBefore}, subItemMappings=${subBefore}`)

      // Use an interactive transaction so all 3 statements commit together.
      await prisma.$transaction(async (tx) => {
        const itemUpdate = await tx.otterItemMapping.updateMany({
          where: { storeId: from },
          data:  { storeId: to },
        })
        const subUpdate = await tx.otterSubItemMapping.updateMany({
          where: { storeId: from },
          data:  { storeId: to },
        })
        await tx.store.delete({ where: { id: from } })
        console.log(`  migrated: ${itemUpdate.count} item mappings, ${subUpdate.count} sub-item mappings`)
        console.log(`  deleted zombie Store row`)
      })

      const itemAfterCanonical = await prisma.otterItemMapping.count({ where: { storeId: to } })
      const subAfterCanonical = await prisma.otterSubItemMapping.count({ where: { storeId: to } })
      console.log(`  after (canonical):  itemMappings=${itemAfterCanonical}, subItemMappings=${subAfterCanonical}`)
    }

    // Final check
    console.log("\n" + "=".repeat(70))
    console.log("Final Store list (account-scoped):")
    console.log("=".repeat(70))
    const stores = await prisma.store.findMany({
      where: { accountId: "acc_default_chrisneddys" },
      include: {
        otterStores: { select: { otterStoreId: true } },
        _count: { select: { otterItemMappings: true, otterSubItemMappings: true } },
      },
      orderBy: { name: "asc" },
    })
    for (const s of stores) {
      console.log(`\n  ${s.name}`)
      console.log(`    id:               ${s.id}`)
      console.log(`    address:          ${s.address ?? "(null)"}`)
      console.log(`    otter UUIDs:      ${s.otterStores.length}`)
      console.log(`    item mappings:    ${s._count.otterItemMappings}`)
      console.log(`    sub-item mappings:${s._count.otterSubItemMappings}`)
    }

    console.log("\nDone.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
