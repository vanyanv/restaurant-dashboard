// scripts/seed-new-stores.ts
// Run with: npx tsx scripts/seed-new-stores.ts
//
// Onboards Van Nuys + Glendale to the multi-store dashboard. Idempotent.
//
// What this does:
//   1. Looks up Hollywood (the existing store) to copy ownerId + accountId.
//   2. Upserts all three Store rows into a canonical name/address format.
//   3. Upserts 6 OtterStore mapping rows (2 Otter UUIDs per physical store —
//      Otter models each location as a POS-side entity + menu-side entity).
//   4. Prints a summary table.
//
// UUID mapping confirmed from Otter admin network captures (Apr 30, 2026).

import { execSync } from "child_process"
import fs from "fs"
import path from "path"

// ---------------------------------------------------------------------------
// 1. Load .env.local (same pattern as seed-otter-store.ts)
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

if (!process.env.DATABASE_URL && env["DATABASE_URL"]) {
  process.env.DATABASE_URL = env["DATABASE_URL"]
}

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL not found. Add DATABASE_URL to .env.local")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Mapping data
// ---------------------------------------------------------------------------

const HOLLYWOOD_STORE_ID = "cmexd4zia0001jr04ljkdt9na"
const VAN_NUYS_STORE_ID = "store-chrisneddys-vannuys"
const GLENDALE_STORE_ID = "store-chrisneddys-glendale"

interface StoreSpec {
  id: string
  name: string
  address: string
  otterUUIDs: string[]
}

const STORES: StoreSpec[] = [
  {
    id: HOLLYWOOD_STORE_ID,
    name: "Chris N Eddys - Hollywood",
    address: "5539 Sunset Blvd, Los Angeles, CA 90028, USA",
    otterUUIDs: [
      "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
      "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
    ],
  },
  {
    id: VAN_NUYS_STORE_ID,
    name: "Chris N Eddys - Van Nuys",
    address: "14523 Sherman Way, Van Nuys, CA 91405, USA",
    otterUUIDs: [
      "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
      "3dff7900-1388-4332-8079-091c3bb96eb4",
    ],
  },
  {
    id: GLENDALE_STORE_ID,
    name: "Chris N Eddys - Glendale",
    address: "1360 Colorado Blvd, Glendale, CA 91205, USA",
    otterUUIDs: [
      "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
      "701340d6-eeac-4a61-92ef-3bec103654ea",
    ],
  },
]

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(70))
  console.log("seed-new-stores: Onboard Van Nuys + Glendale, normalize Hollywood")
  console.log("=".repeat(70))

  // Regenerate Prisma client with local engine (postinstall uses --no-engine)
  console.log("\nRegenerating Prisma client with local engine...")
  execSync("npx prisma generate", { stdio: "inherit" })

  const { PrismaClient } = await import("../src/generated/prisma/client")
  const { PrismaPg } = await import("@prisma/adapter-pg")
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, ssl: true })
  const prisma = new PrismaClient({ adapter })

  try {
    // ---- Look up Hollywood for owner/account context ----
    const hollywood = await prisma.store.findUnique({
      where: { id: HOLLYWOOD_STORE_ID },
      select: { id: true, ownerId: true, accountId: true },
    })

    if (!hollywood) {
      throw new Error(
        `Hollywood store (id=${HOLLYWOOD_STORE_ID}) not found. ` +
          `Cannot infer ownerId/accountId for new stores. Aborting.`
      )
    }

    console.log(`\nFound Hollywood: ownerId=${hollywood.ownerId}, accountId=${hollywood.accountId}`)

    // ---- Upsert Store rows (canonical name + address for all three) ----
    console.log("\nUpserting Store rows...")
    for (const spec of STORES) {
      const result = await prisma.store.upsert({
        where: { id: spec.id },
        create: {
          id: spec.id,
          name: spec.name,
          address: spec.address,
          ownerId: hollywood.ownerId,
          accountId: hollywood.accountId,
          isActive: true,
        },
        update: {
          name: spec.name,
          address: spec.address,
        },
      })
      console.log(`  ${result.id}  →  ${result.name}  |  ${result.address}`)
    }

    // ---- Upsert OtterStore mapping rows (2 per store, 6 total) ----
    console.log("\nUpserting OtterStore mapping rows...")
    for (const spec of STORES) {
      for (const otterStoreId of spec.otterUUIDs) {
        const result = await prisma.otterStore.upsert({
          where: { otterStoreId },
          create: { storeId: spec.id, otterStoreId },
          update: { storeId: spec.id },
        })
        console.log(`  ${result.otterStoreId}  →  storeId=${result.storeId}`)
      }
    }

    // ---- Print summary table ----
    console.log("\n" + "=".repeat(70))
    console.log("Final state:")
    console.log("=".repeat(70))

    const finalStores = await prisma.store.findMany({
      where: { accountId: hollywood.accountId },
      include: { otterStores: { select: { otterStoreId: true } } },
      orderBy: { name: "asc" },
    })

    for (const s of finalStores) {
      console.log(`\n  ${s.name}`)
      console.log(`    id:      ${s.id}`)
      console.log(`    address: ${s.address ?? "(null)"}`)
      console.log(`    active:  ${s.isActive}`)
      console.log(`    otter:   ${s.otterStores.length} UUID(s)`)
      for (const o of s.otterStores) {
        console.log(`             - ${o.otterStoreId}`)
      }
    }

    console.log("\nDone.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err)
  process.exit(1)
})
