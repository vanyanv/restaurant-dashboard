// scripts/drain-otter-order-details.ts
// Drain the historical backlog of OtterOrder rows whose detailsFetchedAt is
// null and that fall outside the regular orders-sync window.
//
// Each invocation processes ONE internal store, capped at --limit rows.
// Schedule via .github/workflows/otter-drain.yml with a per-store matrix
// (max-parallel: 1 — Otter's GraphQL endpoint rate-limits per-token).
//
// Usage:
//   npx tsx scripts/drain-otter-order-details.ts --store-id=<cuid>
//   npx tsx scripts/drain-otter-order-details.ts --store-id=<cuid> --limit=500
//   npx tsx scripts/drain-otter-order-details.ts --store-id=<cuid> --older-than-days=7

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

function parseArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : null
}

async function main() {
  const storeId = parseArg("store-id")
  if (!storeId) {
    console.error(
      "Usage: npx tsx scripts/drain-otter-order-details.ts --store-id=<cuid> [--limit=1500] [--older-than-days=3]",
    )
    process.exit(1)
  }
  const limitStr = parseArg("limit")
  const olderStr = parseArg("older-than-days")
  const limit = limitStr ? parseInt(limitStr, 10) : 1500
  const olderThanDays = olderStr ? parseInt(olderStr, 10) : 3
  if (isNaN(limit) || limit < 1) {
    console.error("Invalid --limit")
    process.exit(1)
  }
  if (isNaN(olderThanDays) || olderThanDays < 1) {
    console.error("Invalid --older-than-days")
    process.exit(1)
  }

  const usingEnvJwt = !!process.env.OTTER_JWT
  console.log(
    `[otter] ${usingEnvJwt ? "using OTTER_JWT env (cached)" : "no OTTER_JWT env — will perform login per-process"}`,
  )

  const { prisma } = await import("../src/lib/prisma")
  const { runDetailsDrain } = await import("../src/lib/otter-orders-sync")

  // Fail fast if the store doesn't exist or is inactive — the matrix would
  // otherwise quietly do nothing for a stale storeId.
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, isActive: true },
  })
  if (!store) {
    console.error(`Store ${storeId} not found.`)
    await prisma.$disconnect()
    process.exit(1)
  }
  if (!store.isActive) {
    console.log(`Store ${store.name} is inactive. Skipping.`)
    await prisma.$disconnect()
    return
  }

  console.log(
    `\nDrain — store=${store.name} (${storeId}), limit=${limit}, olderThanDays=${olderThanDays}\n`,
  )

  const t0 = Date.now()
  const result = await runDetailsDrain(storeId, {
    limit,
    olderThanDays,
    triggeredBy: "internal",
    metadata: { source: "scripts/drain-otter-order-details.ts" },
  })
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(
    `Drain done in ${elapsedSec}s: pending ${result.pendingBefore} → ${result.pendingAfter} ` +
      `(fetched=${result.detailsFetched}, failed=${result.detailsFailed})`,
  )

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error("Drain failed:", err)
  process.exit(1)
})
