// One-time backfill of historical Otter orders into OtterOrder/OtterOrderItem/OtterOrderSubItem.
// Run with:
//   npx tsx scripts/backfill-orders.ts                        # 90 days ending now (default)
//   npx tsx scripts/backfill-orders.ts 30                     # 30 days ending now
//   npx tsx scripts/backfill-orders.ts 30 2026-04-04T23:24Z   # 30 days ending at ISO date
//   npx tsx scripts/backfill-orders.ts --walk                 # walk backward, 60-day chunks
//   npx tsx scripts/backfill-orders.ts --walk 30              # walk backward, 30-day chunks
//
// Why --walk: the Otter metrics_explorer query is hard-capped at 5000 rows/response
// and sorted DESC, so one call only ever yields the 5000 most-recent orders in the
// window. Walk mode anchors the window's end at MIN(OtterOrder.referenceTimeLocal)
// and re-runs until the API returns no new orders — that's how far Otter retains.

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

const startTime = Date.now()
function elapsed(): string {
  const s = Math.floor((Date.now() - startTime) / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}m${String(sec).padStart(2, "0")}s`
}

const WALK_MAX_PASSES = 30

async function runDetailPasses(
  runOrdersSync: (days: number, endDate?: Date) => Promise<{
    storesProcessed: number
    ordersFetched: number
    ordersCreated: number
    ordersUpdated: number
    detailsFetched: number
    detailsFailed: number
    pendingDetails: number
    windowDays: number
  }>,
  days: number,
  endDate: Date | undefined,
  label: string,
) {
  let totalOrdersCreated = 0
  let totalOrdersUpdated = 0
  let totalDetailsFetched = 0
  let totalDetailsFailed = 0
  let firstPassOrdersCreated = 0
  let pass = 1

  while (true) {
    console.log(`[${elapsed()}] ${label} pass #${pass}: runOrdersSync(${days}${endDate ? `, ${endDate.toISOString()}` : ""})…`)
    const result = await runOrdersSync(days, endDate)
    console.log(`  storesProcessed:  ${result.storesProcessed}`)
    console.log(`  ordersFetched:    ${result.ordersFetched}`)
    console.log(`  ordersCreated:    ${result.ordersCreated}`)
    console.log(`  ordersUpdated:    ${result.ordersUpdated}`)
    console.log(`  detailsFetched:   ${result.detailsFetched}`)
    console.log(`  detailsFailed:    ${result.detailsFailed}`)
    console.log(`  pendingDetails:   ${result.pendingDetails}`)
    console.log(`  windowDays:       ${result.windowDays}`)

    if (pass === 1) firstPassOrdersCreated = result.ordersCreated
    totalOrdersCreated += result.ordersCreated
    totalOrdersUpdated += result.ordersUpdated
    totalDetailsFetched += result.detailsFetched
    totalDetailsFailed += result.detailsFailed

    const noMoreProgress = result.detailsFetched === 0 && result.detailsFailed === 0
    if (result.pendingDetails === 0 || noMoreProgress) break
    if (pass >= 5) {
      console.log(`\n  Reached pass limit (5); remaining pending=${result.pendingDetails}.`)
      break
    }
    pass++
  }

  return { totalOrdersCreated, totalOrdersUpdated, totalDetailsFetched, totalDetailsFailed, firstPassOrdersCreated }
}

async function main() {
  const args = process.argv.slice(2)
  const isWalk = args[0] === "--walk"

  const { runOrdersSync } = await import("../src/lib/otter-orders-sync")
  const { prisma } = await import("../src/lib/prisma")

  if (isWalk) {
    const chunkDays = Number(args[1] ?? 60)
    if (!Number.isFinite(chunkDays) || chunkDays < 1) {
      console.error("Usage: npx tsx scripts/backfill-orders.ts --walk [chunkDays>=1]")
      process.exit(1)
    }

    console.log(`Starting walk-backward backfill at ${new Date().toISOString()}`)
    console.log(`Chunk size: ${chunkDays} days; anchor: MIN(OtterOrder.referenceTimeLocal) per pass.\n`)

    let grandCreated = 0
    let grandUpdated = 0
    let grandDetails = 0
    let grandDetailsFailed = 0

    for (let walkPass = 1; walkPass <= WALK_MAX_PASSES; walkPass++) {
      const oldest = await prisma.otterOrder.aggregate({ _min: { referenceTimeLocal: true } })
      const oldestDate = oldest._min.referenceTimeLocal
      const endDate = oldestDate ? new Date(oldestDate.getTime() - 1) : undefined

      console.log(`\n═══ Walk pass ${walkPass}/${WALK_MAX_PASSES} — end=${endDate ? endDate.toISOString() : "now"} ═══`)

      const { totalOrdersCreated, totalOrdersUpdated, totalDetailsFetched, totalDetailsFailed, firstPassOrdersCreated } =
        await runDetailPasses(runOrdersSync, chunkDays, endDate, `  walk ${walkPass}`)

      grandCreated += totalOrdersCreated
      grandUpdated += totalOrdersUpdated
      grandDetails += totalDetailsFetched
      grandDetailsFailed += totalDetailsFailed

      // Stop when the very first phase-1 fetch of this walk pass yielded zero new orders.
      if (firstPassOrdersCreated === 0) {
        console.log(`\nWalk terminated: no new orders in pass ${walkPass} — Otter has nothing older.`)
        break
      }
    }

    console.log(`\n[${elapsed()}] Walk complete.`)
    console.log(`  grand total orders created:  ${grandCreated}`)
    console.log(`  grand total orders updated:  ${grandUpdated}`)
    console.log(`  grand total details fetched: ${grandDetails}`)
    console.log(`  grand total details failed:  ${grandDetailsFailed}`)

    const finalAgg = await prisma.otterOrder.aggregate({
      _count: { _all: true },
      _min: { referenceTimeLocal: true },
      _max: { referenceTimeLocal: true },
    })
    console.log(`  db now: ${finalAgg._count._all} orders, ${finalAgg._min.referenceTimeLocal?.toISOString()} → ${finalAgg._max.referenceTimeLocal?.toISOString()}`)

    await prisma.$disconnect()
    return
  }

  // Non-walk: original behavior + optional ISO end-date as second arg.
  const daysArg = Number(args[0] ?? 90)
  if (!Number.isFinite(daysArg) || daysArg < 1) {
    console.error("Usage: npx tsx scripts/backfill-orders.ts [days>=1] [endDateISO]")
    process.exit(1)
  }
  let endDate: Date | undefined
  if (args[1]) {
    endDate = new Date(args[1])
    if (isNaN(endDate.getTime())) {
      console.error(`Invalid endDateISO: ${args[1]}`)
      process.exit(1)
    }
  }

  console.log(`Starting ${daysArg}-day orders backfill at ${new Date().toISOString()}${endDate ? ` (ending ${endDate.toISOString()})` : ""}`)
  console.log("Phase 1 fetches customer_orders headers; phase 2 fetches per-order details (GraphQL).")
  console.log("Rerun the script if `pendingDetails` > 0 at the end — phase 2 is capped at 2000 per run.\n")

  const { totalOrdersCreated, totalOrdersUpdated, totalDetailsFetched, totalDetailsFailed } =
    await runDetailPasses(runOrdersSync, daysArg, endDate, "")

  console.log(`\n[${elapsed()}] Backfill complete.`)
  console.log(`  total orders created:  ${totalOrdersCreated}`)
  console.log(`  total orders updated:  ${totalOrdersUpdated}`)
  console.log(`  total details fetched: ${totalDetailsFetched}`)
  console.log(`  total details failed:  ${totalDetailsFailed}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
