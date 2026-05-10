// scripts/sync-harri-hourly.ts
// Cron-driven Harri labor sync. Iterates every active HarriBrand and re-syncs
// the trailing 3 days (covers retroactive punch edits). Same engine the manual
// route at src/app/api/cron/harri/route.ts uses; lifted to a script so the
// GitHub Actions workflow doesn't depend on a deployed Next.js runtime.
//
// Usage:
//   pnpm tsx scripts/sync-harri-hourly.ts             # all active brands, last 3 days
//   pnpm tsx scripts/sync-harri-hourly.ts --store=<id>
//   pnpm tsx scripts/sync-harri-hourly.ts --days=7

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
  const daysArg = parseArg("days")
  const days = Math.max(1, Math.min(14, daysArg ? Number(daysArg) : 3))

  const { prisma } = await import("../src/lib/prisma")
  const { runHarriLaborSync } = await import("../src/lib/harri-labor-sync")

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))

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
      console.log("[harri.sync] no active brands found")
      return
    }

    console.log(
      `[harri.sync] window=${startDate.toISOString().slice(0, 10)}..${endDate
        .toISOString()
        .slice(0, 10)} brands=${brands.length}`
    )

    type Summary = {
      storeId: string
      brandId: number
      daysWritten: number
      positionsWritten: number
      alertsWritten: number
      error?: string
    }
    const summaries: Summary[] = []
    let totalDays = 0
    let totalAlerts = 0

    for (const b of brands) {
      console.log(
        `[harri.sync] storeId=${b.storeId} brandId=${b.brandId} (${b.brandName ?? "—"})`
      )
      try {
        const r = await runHarriLaborSync({
          storeId: b.storeId,
          startDate,
          endDate,
          triggeredBy: "github-actions",
        })
        console.log(
          `[harri.sync]   daysWritten=${r.daysWritten} positionsWritten=${r.positionsWritten} alertsWritten=${r.alertsWritten}`
        )
        totalDays += r.daysWritten
        totalAlerts += r.alertsWritten
        summaries.push({ storeId: b.storeId, brandId: b.brandId, ...r })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[harri.sync]   FAILED: ${message}`)
        summaries.push({
          storeId: b.storeId,
          brandId: b.brandId,
          daysWritten: 0,
          positionsWritten: 0,
          alertsWritten: 0,
          error: message.slice(0, 300),
        })
      }
      if (brands.indexOf(b) < brands.length - 1) {
        await new Promise((r) => setTimeout(r, 1_500))
      }
    }

    const failed = summaries.filter((s) => s.error).length
    console.log(
      `[harri.sync] done · totalDaysWritten=${totalDays} totalAlertsWritten=${totalAlerts} failed=${failed}/${brands.length}`
    )

    if (failed > 0) process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("[harri.sync] fatal:", err)
  process.exit(1)
})
