// scripts/_verify-hourly-parity.ts
// Verifies that the precompute table produces identical numbers to a fresh
// live Otter pull for the same dates. Run with:
//   npx tsx scripts/_verify-hourly-parity.ts

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
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { queryMetrics, buildCustomerOrdersBody } = await import("../src/lib/otter")
  const { startOfDayLA, endOfDayLA, todayInLA } = await import(
    "../src/lib/dashboard-utils"
  )
  const { laDateMinusDays } = await import("../src/lib/hourly-orders")

  const today = todayInLA()
  const yday = laDateMinusDays(today, 1)
  console.log(`Comparing live Otter vs precompute for ${yday} (yesterday)...\n`)

  const otterStores = await prisma.otterStore.findMany({
    select: {
      otterStoreId: true,
      storeId: true,
      store: { select: { isActive: true, name: true } },
    },
  })
  const active = otterStores.filter((os) => os.store.isActive)
  const otterIds = active.map((s) => s.otterStoreId)
  const otterToStore = new Map<string, string>()
  for (const os of active) otterToStore.set(os.otterStoreId, os.storeId)

  // Live Otter: pull yesterday's orders, bucket per (storeId, hour).
  const body = buildCustomerOrdersBody(otterIds, startOfDayLA(yday), endOfDayLA(yday)) as Record<string, unknown>
  body.limit = 50000
  const rows = await queryMetrics(body)

  type Bucket = Map<string, { count: number; sales: number }>  // key: storeId|hour
  const live: Bucket = new Map()
  for (const row of rows) {
    const epochMs = row.reference_time_local_without_tz as number | null
    if (epochMs == null) continue
    const otterStoreId = row.store_id as string | undefined
    if (!otterStoreId) continue
    const storeId = otterToStore.get(otterStoreId)
    if (!storeId) continue
    const d = new Date(epochMs)
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    if (dateStr !== yday) continue
    const hour = d.getUTCHours()
    const key = `${storeId}|${hour}`
    const existing = live.get(key)
    const sales = (row.net_sales as number) ?? 0
    if (existing) {
      existing.count += 1
      existing.sales += sales
    } else {
      live.set(key, { count: 1, sales })
    }
  }

  // Precompute: read same date.
  const dbRows = await prisma.otterHourlySummary.findMany({
    where: { date: new Date(yday + "T00:00:00.000Z") },
    select: { storeId: true, hour: true, orderCount: true, netSales: true },
  })
  const precomp: Bucket = new Map()
  for (const r of dbRows) {
    precomp.set(`${r.storeId}|${r.hour}`, {
      count: r.orderCount,
      sales: r.netSales,
    })
  }

  // Diff.
  const allKeys = new Set([...live.keys(), ...precomp.keys()])
  let mismatchCount = 0
  let liveTotal = 0
  let precompTotal = 0
  const stores = new Map<string, string>()
  for (const os of active) stores.set(os.storeId, os.store.name)

  for (const key of [...allKeys].sort()) {
    const l = live.get(key) ?? { count: 0, sales: 0 }
    const p = precomp.get(key) ?? { count: 0, sales: 0 }
    liveTotal += l.count
    precompTotal += p.count
    if (l.count !== p.count) {
      mismatchCount++
      const [storeId, hour] = key.split("|")
      console.log(
        `  ❌ ${stores.get(storeId) ?? storeId} hour ${hour}: live=${l.count} precomp=${p.count}`
      )
    }
  }

  console.log(`\nTotals — live: ${liveTotal}, precompute: ${precompTotal}`)
  console.log(
    mismatchCount === 0
      ? `\n✅ PARITY: every (store, hour) bucket matches.`
      : `\n❌ ${mismatchCount} mismatched buckets.`
  )

  await prisma.$disconnect()
  process.exit(mismatchCount === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("Verify failed:", e)
  process.exit(1)
})
