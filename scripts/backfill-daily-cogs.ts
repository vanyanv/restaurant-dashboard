// scripts/backfill-daily-cogs.ts
// One-shot backfill of DailyCogsItem rows for every owner's active stores.
// Idempotent: writes are upserts and the per-day cleanup is bounded to that
// day, so re-running is safe and historical rows from other days are never
// touched.
//
// Run with: npx tsx scripts/backfill-daily-cogs.ts [lookbackDays]
//   npx tsx scripts/backfill-daily-cogs.ts                         # 365 days (default)
//   npx tsx scripts/backfill-daily-cogs.ts 90                      # 90 days
//   npx tsx scripts/backfill-daily-cogs.ts 90 --stores=2 --days=4  # tune concurrency

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

type StoreJob = {
  ownerEmail: string
  accountId: string
  store: { id: string; name: string }
}

type StoreJobResult =
  | {
      ok: true
      ownerEmail: string
      storeName: string
      daysProcessed: number
      rowsUpserted: number
      rowsDeleted: number
      durationMs: number
    }
  | {
      ok: false
      ownerEmail: string
      storeName: string
      error: unknown
      durationMs: number
    }

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { recomputeDailyCogsForRange } = await import("../src/lib/cogs-materializer")

  const { lookbackDays, storeConcurrency, dayConcurrency } = parseArgs()

  const owners = await prisma.user.findMany({
    where: { role: "OWNER" },
    select: { accountId: true, email: true },
  })

  const endDate = new Date()
  endDate.setUTCHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

  console.log(
    `Backfilling DailyCogsItem for ${owners.length} owner(s), lookback ${lookbackDays}d ` +
      `(${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)})`
  )
  console.log(
    `Concurrency: ${storeConcurrency} store job(s), ${dayConcurrency} day job(s) per store`
  )

  const storesByOwner = await Promise.all(
    owners.map(async (owner) => {
      const stores = await prisma.store.findMany({
        where: { accountId: owner.accountId, isActive: true },
        select: { id: true, name: true },
      })
      return stores.map((store): StoreJob => ({
        ownerEmail: owner.email,
        accountId: owner.accountId,
        store,
      }))
    })
  )
  const jobs = storesByOwner.flat()

  const results = await mapWithConcurrency(
    jobs,
    storeConcurrency,
    async (job) => {
      const start = Date.now()
      try {
        const result = await recomputeDailyCogsForRange({
          storeId: job.store.id,
          startDate,
          endDate,
          accountId: job.accountId,
          dayConcurrency,
        })
        const ms = Date.now() - start
        console.log(
          `  ${job.ownerEmail} / ${job.store.name}: ${result.daysProcessed} day(s), ` +
            `${result.rowsUpserted} upserted, ${result.rowsDeleted} cleaned — ${ms}ms`
        )
        return {
          ok: true,
          ownerEmail: job.ownerEmail,
          storeName: job.store.name,
          durationMs: ms,
          ...result,
        } satisfies StoreJobResult
      } catch (err) {
        const ms = Date.now() - start
        console.error(`  ${job.ownerEmail} / ${job.store.name}: FAILED`, err)
        return {
          ok: false,
          ownerEmail: job.ownerEmail,
          storeName: job.store.name,
          error: err,
          durationMs: ms,
        } satisfies StoreJobResult
      }
    }
  )

  const successes = results.filter(
    (r): r is Extract<StoreJobResult, { ok: true }> => r.ok
  )
  const failures = results.filter(
    (r): r is Extract<StoreJobResult, { ok: false }> => !r.ok
  )
  const totalDays = successes.reduce((sum, result) => sum + result.daysProcessed, 0)
  const totalUpserted = successes.reduce((sum, result) => sum + result.rowsUpserted, 0)
  const totalDeleted = successes.reduce((sum, result) => sum + result.rowsDeleted, 0)

  console.log(
    `Done: ${totalDays} day(s), ${totalUpserted} upserted, ${totalDeleted} cleaned` +
      (failures.length ? `, ${failures.length} failed store(s)` : "")
  )
  await prisma.$disconnect()
  if (failures.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

function parseArgs(): {
  lookbackDays: number
  storeConcurrency: number
  dayConcurrency: number
} {
  const positional = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("--"))
  const lookbackDays = Number.parseInt(positional ?? "", 10) || 365
  const storeConcurrency = readConcurrencyFlag(
    "stores",
    process.env.COGS_BACKFILL_STORE_CONCURRENCY,
    2
  )
  const dayConcurrency = readConcurrencyFlag(
    "days",
    process.env.COGS_BACKFILL_DAY_CONCURRENCY,
    4
  )
  return { lookbackDays, storeConcurrency, dayConcurrency }
}

function readConcurrencyFlag(
  name: string,
  envValue: string | undefined,
  fallback: number
): number {
  const prefix = `--${name}=`
  const raw =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith(prefix))
      ?.slice(prefix.length) ?? envValue
  const parsed = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, parsed)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex
        nextIndex++
        if (currentIndex >= items.length) return
        results[currentIndex] = await worker(items[currentIndex])
      }
    })
  )

  return results
}
