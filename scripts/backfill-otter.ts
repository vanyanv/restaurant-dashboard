// scripts/backfill-otter.ts
// Backfill Otter metrics into the database, store-by-store, chunk-by-chunk.
//
// All sync logic lives in src/lib/otter-metrics-sync.ts; this script just
// drives the runner across a wider window than the API route does (default
// 365 days), in 30-day chunks per (store, chunk) to stay well under Otter's
// per-query row limits.
//
// Usage:
//   npx tsx scripts/backfill-otter.ts                       # 365 days, all active stores
//   npx tsx scripts/backfill-otter.ts 90                    # 90 days
//   npx tsx scripts/backfill-otter.ts 3 --daily-only        # daily-summary only
//   npx tsx scripts/backfill-otter.ts 3 --store-id=<cuid>   # one store only
//
// Each (store, chunk) call records its own JobRun row via the runner's
// withJobRun wrapping, so the GitHub Actions workflow gets per-store telemetry.

import fs from "fs"
import path from "path"

// --- Load .env.local BEFORE dynamic imports that read process.env ---
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

const CHUNK_DAYS = 30
const INTER_CHUNK_DELAY_MS = 2000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const startTime = Date.now()
function elapsed(): string {
  const s = Math.floor((Date.now() - startTime) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}m${String(sec).padStart(2, "0")}s`
}

function parseArgs(): { days: number; dailyOnly: boolean; storeIdFilter: string | null } {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const days = parseInt(positional[0] || "365", 10)
  if (isNaN(days) || days < 1) {
    console.error(
      "Usage: npx tsx scripts/backfill-otter.ts [days] [--daily-only] [--store-id=<id>]",
    )
    process.exit(1)
  }
  const dailyOnly = process.argv.includes("--daily-only")
  const storeIdArg = process.argv.find((a) => a.startsWith("--store-id="))
  const storeIdFilter = storeIdArg ? storeIdArg.slice("--store-id=".length) : null
  return { days, dailyOnly, storeIdFilter }
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { runMetricsSyncForStore } = await import("../src/lib/otter-metrics-sync")

  const { days, dailyOnly, storeIdFilter } = parseArgs()

  const usingEnvJwt = !!process.env.OTTER_JWT
  console.log(
    `\nOtter Backfill — ${days} days${dailyOnly ? " (daily-only)" : ""}${storeIdFilter ? ` (store=${storeIdFilter})` : ""}`,
  )
  console.log(
    `[otter] ${usingEnvJwt ? "using OTTER_JWT env (cached)" : "no OTTER_JWT env — will perform login per-process"}\n`,
  )

  // Fetch active Otter stores, optionally filtered to one internal store.
  const otterStores = await prisma.otterStore.findMany({
    include: { store: { select: { id: true, name: true, isActive: true } } },
  })
  const activeStores = otterStores.filter(
    (os) =>
      os.store.isActive && (storeIdFilter == null || os.storeId === storeIdFilter),
  )

  if (activeStores.length === 0) {
    if (storeIdFilter) {
      console.error(
        `No active Otter store found for storeId=${storeIdFilter}. Exiting.`,
      )
      process.exit(1)
    }
    console.log("No active Otter stores found. Exiting.")
    await prisma.$disconnect()
    return
  }

  // Group Otter UUIDs by internal storeId (multiple UUIDs may map to one store).
  const storeGroups = new Map<string, { uuids: string[]; name: string }>()
  for (const os of activeStores) {
    const entry = storeGroups.get(os.storeId) ?? { uuids: [], name: os.store.name }
    entry.uuids.push(os.otterStoreId)
    storeGroups.set(os.storeId, entry)
  }

  console.log(
    `Stores: ${[...storeGroups.values()].map((s) => s.name).join(", ")} (${storeGroups.size} internal, ${activeStores.length} Otter UUIDs)\n`,
  )

  type ChunkTotals = {
    daily: number
    dailyFailed: number
    categories: number
    categoriesFailed: number
    items: number
    itemsFailed: number
    modifiers: number
    modifiersFailed: number
  }
  const totalsByStore = new Map<string, ChunkTotals>()
  for (const sid of storeGroups.keys()) {
    totalsByStore.set(sid, {
      daily: 0,
      dailyFailed: 0,
      categories: 0,
      categoriesFailed: 0,
      items: 0,
      itemsFailed: 0,
      modifiers: 0,
      modifiersFailed: 0,
    })
  }

  const totalChunks = Math.ceil(days / CHUNK_DAYS)

  for (let chunk = 0; chunk < totalChunks; chunk++) {
    const daysBack = days - chunk * CHUNK_DAYS
    const daysBackEnd = Math.max(daysBack - CHUNK_DAYS, 0)

    const endDate = new Date()
    endDate.setUTCDate(endDate.getUTCDate() - daysBackEnd)
    endDate.setUTCHours(23, 59, 59, 999)

    const startDate = new Date()
    startDate.setUTCDate(startDate.getUTCDate() - daysBack)
    startDate.setUTCHours(0, 0, 0, 0)

    console.log(
      `\n[${elapsed()}] Chunk ${chunk + 1}/${totalChunks}: days ${daysBack}-${daysBackEnd} (${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)})`,
    )

    for (const [sid, { uuids, name }] of storeGroups) {
      try {
        const result = await runMetricsSyncForStore(sid, uuids, startDate, endDate, {
          triggeredBy: "internal",
          dailyOnly,
          includeRatings: false,
          metadata: {
            source: "scripts/backfill-otter.ts",
            chunkIndex: chunk,
            totalChunks,
            daysLookback: days,
          },
        })
        const t = totalsByStore.get(sid)!
        t.daily += result.daily.synced
        t.dailyFailed += result.daily.failed
        t.categories += result.categories.synced
        t.categoriesFailed += result.categories.failed
        t.items += result.items.synced
        t.itemsFailed += result.items.failed
        t.modifiers += result.modifiers.synced
        t.modifiersFailed += result.modifiers.failed
        console.log(
          `  ${name}: daily=${result.daily.synced} cat=${result.categories.synced} items=${result.items.synced} mods=${result.modifiers.synced}` +
            (result.daily.failed +
              result.categories.failed +
              result.items.failed +
              result.modifiers.failed >
            0
              ? ` (failed: d=${result.daily.failed} c=${result.categories.failed} i=${result.items.failed} m=${result.modifiers.failed})`
              : ""),
        )
      } catch (err) {
        console.error(
          `  ${name}: chunk failed — ${err instanceof Error ? err.message : err}`,
        )
        // Continue with next store; one store's failure shouldn't block the rest.
      }
    }

    if (chunk < totalChunks - 1) {
      console.log(`  [${elapsed()}] Pausing ${INTER_CHUNK_DELAY_MS / 1000}s before next chunk…`)
      await sleep(INTER_CHUNK_DELAY_MS)
    }
  }

  console.log(`\n--- Backfill Complete [${elapsed()}] ---`)
  let grandDaily = 0
  let grandCategories = 0
  let grandItems = 0
  let grandModifiers = 0
  for (const [sid, t] of totalsByStore) {
    const name = storeGroups.get(sid)?.name ?? sid
    console.log(
      `  ${name.padEnd(20)} daily=${t.daily} cat=${t.categories} items=${t.items} mods=${t.modifiers}` +
        (t.dailyFailed + t.categoriesFailed + t.itemsFailed + t.modifiersFailed > 0
          ? ` (failed: d=${t.dailyFailed} c=${t.categoriesFailed} i=${t.itemsFailed} m=${t.modifiersFailed})`
          : ""),
    )
    grandDaily += t.daily
    grandCategories += t.categories
    grandItems += t.items
    grandModifiers += t.modifiers
  }
  console.log(
    `  TOTAL                daily=${grandDaily} cat=${grandCategories} items=${grandItems} mods=${grandModifiers}\n`,
  )

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Backfill failed:", err)
  process.exit(1)
})
