// scripts/backfill-harri-employees.ts
// Resolve Harri user_ids → first/last names. Same code path as the monthly
// cron at src/app/api/cron/harri-employees/route.ts; runnable from CLI for
// the initial backfill or any time we want to force an early refresh.
//
// Usage:
//   pnpm tsx scripts/backfill-harri-employees.ts              # all active brands
//   pnpm tsx scripts/backfill-harri-employees.ts --store=<id> # one brand only

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

function parseArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

async function main() {
  const onlyStore = parseArg("store")

  const { prisma } = await import("../src/lib/prisma")
  const { refreshHarriEmployees } = await import("../src/lib/harri-employee-sync")

  try {
    const brands = await prisma.harriBrand.findMany({
      where: {
        active: true,
        ...(onlyStore ? { storeId: onlyStore } : {}),
      },
      select: { storeId: true, brandId: true, brandName: true },
      orderBy: { createdAt: "asc" },
    })

    if (brands.length === 0) {
      console.log("[harri.employees.backfill] no active brands found")
      return
    }

    let totalUpserted = 0
    for (const b of brands) {
      console.log(
        `[harri.employees.backfill] storeId=${b.storeId} brandId=${b.brandId} (${b.brandName ?? "—"})`
      )
      try {
        const r = await refreshHarriEmployees({
          storeId: b.storeId,
          brandId: b.brandId,
          triggeredBy: "github-actions",
        })
        console.log(
          `[harri.employees.backfill]   requested=${r.requested} fetched=${r.fetched} upserted=${r.upserted}`
        )
        totalUpserted += r.upserted
      } catch (err) {
        console.error(`[harri.employees.backfill]   FAILED:`, err)
      }
      // Be polite to Harri's gateway between brands.
      if (brands.indexOf(b) < brands.length - 1) {
        await new Promise((r) => setTimeout(r, 1_000))
      }
    }

    console.log(`[harri.employees.backfill] done · totalUpserted=${totalUpserted}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("[harri.employees.backfill] fatal:", err)
  process.exit(1)
})
