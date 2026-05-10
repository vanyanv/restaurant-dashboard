// scripts/backfill-harri.ts
// Manual / GH-Actions backfill driver for the Harri (LiveWire) sync.
// Walks the date window in 30-day chunks (matches scripts/backfill-otter.ts).
//
// Usage:
//   pnpm tsx scripts/backfill-harri.ts --store=<storeId> --days=90
//   pnpm tsx scripts/backfill-harri.ts --store=<storeId> --start=2026-01-01 --end=2026-05-08

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

const CHUNK_DAYS = 14
const PAUSE_MS = 2_000
const MAX_CHUNK_RETRIES = 3

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

async function main() {
  const storeId = parseArg("store")
  if (!storeId) {
    console.error("Usage: pnpm tsx scripts/backfill-harri.ts --store=<storeId> [--days=N | --start=YYYY-MM-DD --end=YYYY-MM-DD]")
    process.exit(1)
  }

  const startStr = parseArg("start")
  const endStr = parseArg("end")
  let start: Date
  let end: Date
  if (startStr && endStr) {
    start = new Date(startStr + "T00:00:00.000Z")
    end = new Date(endStr + "T00:00:00.000Z")
  } else {
    const days = Number(parseArg("days") ?? "90")
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      console.error("--days must be 1-365")
      process.exit(1)
    }
    end = new Date()
    end.setUTCHours(0, 0, 0, 0)
    start = addDays(end, -(days - 1))
  }

  console.log(
    `[harri.backfill] storeId=${storeId} window=${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`
  )

  const { runHarriLaborSync } = await import("../src/lib/harri-labor-sync")
  const { prisma } = await import("../src/lib/prisma")

  try {
    const totals = { daysWritten: 0, positionsWritten: 0, alertsWritten: 0 }
    let chunkStart = new Date(start)
    while (chunkStart <= end) {
      const chunkEnd = (() => {
        const candidate = addDays(chunkStart, CHUNK_DAYS - 1)
        return candidate < end ? candidate : end
      })()
      const t0 = Date.now()
      console.log(
        `[harri.backfill] chunk ${chunkStart.toISOString().slice(0, 10)}..${chunkEnd.toISOString().slice(0, 10)}`
      )
      let attempt = 0
      let result: { daysWritten: number; positionsWritten: number; alertsWritten: number } | null = null
      while (attempt < MAX_CHUNK_RETRIES) {
        attempt += 1
        try {
          result = await runHarriLaborSync({
            storeId,
            startDate: chunkStart,
            endDate: chunkEnd,
            triggeredBy: "github-actions",
          })
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[harri.backfill]   attempt ${attempt}/${MAX_CHUNK_RETRIES} failed: ${msg.slice(0, 160)}`)
          if (attempt >= MAX_CHUNK_RETRIES) throw err
          await new Promise((r) => setTimeout(r, 4_000 * attempt))
        }
      }
      if (!result) throw new Error("unreachable")
      totals.daysWritten += result.daysWritten
      totals.positionsWritten += result.positionsWritten
      totals.alertsWritten += result.alertsWritten
      console.log(
        `[harri.backfill]   wrote days=${result.daysWritten} positions=${result.positionsWritten} alerts=${result.alertsWritten} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
      )
      chunkStart = addDays(chunkEnd, 1)
      if (chunkStart <= end) await new Promise((r) => setTimeout(r, PAUSE_MS))
    }
    console.log(`[harri.backfill] done: ${JSON.stringify(totals)}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("[harri.backfill] failed:", err)
  process.exit(1)
})
