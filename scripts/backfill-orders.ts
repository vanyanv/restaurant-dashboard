// One-time backfill of historical Otter orders into OtterOrder/OtterOrderItem/OtterOrderSubItem.
// Run with: npx tsx scripts/backfill-orders.ts [days]
//   npx tsx scripts/backfill-orders.ts          # 90 days (default)
//   npx tsx scripts/backfill-orders.ts 30       # 30 days

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

async function main() {
  const daysArg = Number(process.argv[2] ?? 90)
  if (!Number.isFinite(daysArg) || daysArg < 1) {
    console.error("Usage: npx tsx scripts/backfill-orders.ts [days>=1]")
    process.exit(1)
  }

  const { runOrdersSync } = await import("../src/lib/otter-orders-sync")

  console.log(`Starting ${daysArg}-day orders backfill at ${new Date().toISOString()}`)
  console.log("Phase 1 fetches customer_orders headers; phase 2 fetches per-order details (GraphQL).")
  console.log("Rerun the script if `pendingDetails` > 0 at the end — phase 2 is capped at 2000 per run.\n")

  let totalOrdersCreated = 0
  let totalOrdersUpdated = 0
  let totalDetailsFetched = 0
  let totalDetailsFailed = 0
  let pass = 1

  while (true) {
    console.log(`[${elapsed()}] pass #${pass}: runOrdersSync(${daysArg})…`)
    const result = await runOrdersSync(daysArg)
    console.log(`  storesProcessed:  ${result.storesProcessed}`)
    console.log(`  ordersFetched:    ${result.ordersFetched}`)
    console.log(`  ordersCreated:    ${result.ordersCreated}`)
    console.log(`  ordersUpdated:    ${result.ordersUpdated}`)
    console.log(`  detailsFetched:   ${result.detailsFetched}`)
    console.log(`  detailsFailed:    ${result.detailsFailed}`)
    console.log(`  pendingDetails:   ${result.pendingDetails}`)
    console.log(`  windowDays:       ${result.windowDays}`)

    totalOrdersCreated += result.ordersCreated
    totalOrdersUpdated += result.ordersUpdated
    totalDetailsFetched += result.detailsFetched
    totalDetailsFailed += result.detailsFailed

    // Break if no more pending details to fetch OR no progress on this pass.
    const noMoreProgress = result.detailsFetched === 0 && result.detailsFailed === 0
    if (result.pendingDetails === 0 || noMoreProgress) break

    // Stop after 5 passes to prevent runaway.
    if (pass >= 5) {
      console.log(`\n  Reached pass limit (5); remaining pending=${result.pendingDetails}.`)
      break
    }
    pass++
  }

  console.log(`\n[${elapsed()}] Backfill complete.`)
  console.log(`  total orders created:  ${totalOrdersCreated}`)
  console.log(`  total orders updated:  ${totalOrdersUpdated}`)
  console.log(`  total details fetched: ${totalDetailsFetched}`)
  console.log(`  total details failed:  ${totalDetailsFailed}`)

  const { prisma } = await import("../src/lib/prisma")
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
