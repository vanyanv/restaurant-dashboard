// scripts/audit/missing-cogs-days.ts
//
// Reports per-store dates where OtterMenuItem has sales rows but DailyCogsItem
// has no rows. Under the new "always upsert, cutoff per recipe" model, gaps
// mean: either the day has no costable items at all (no recipe mappings, no
// matched invoices), or the materializer cron hasn't run for it yet. Either
// way, this is the surface to watch.
//
// Run standalone:
//   pnpm tsx scripts/audit/missing-cogs-days.ts
//   pnpm tsx scripts/audit/missing-cogs-days.ts --days 90
//
// In CI: cogs-audit.yml pipes the output to $GITHUB_STEP_SUMMARY.

import { loadEnvLocal } from "./lib"

loadEnvLocal()

type GapsByStore = {
  storeId: string
  storeName: string
  totalGapDays: number
  earliestGap: string | null
  latestGap: string | null
  sampleDates: string[]
}

async function main(): Promise<void> {
  const { prisma } = await import("../../src/lib/prisma")

  const argDays = process.argv.find((a) => a.startsWith("--days="))
  const argFlagIdx = process.argv.indexOf("--days")
  const lookbackDays = argDays
    ? Number.parseInt(argDays.split("=")[1], 10)
    : argFlagIdx >= 0
      ? Number.parseInt(process.argv[argFlagIdx + 1] ?? "", 10)
      : 365

  if (!Number.isFinite(lookbackDays) || lookbackDays < 1) {
    console.error("Invalid --days value")
    process.exit(2)
  }

  const cutoff = new Date()
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays)

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  console.log(
    `Missing-COGS-days audit — ${lookbackDays}d lookback (since ${dateKey(cutoff)})`
  )
  console.log(`Stores: ${stores.length}`)
  console.log("")

  const results: GapsByStore[] = []

  for (const store of stores) {
    const [menuDays, cogsDays] = await Promise.all([
      prisma.otterMenuItem.groupBy({
        by: ["date"],
        where: {
          storeId: store.id,
          isModifier: false,
          date: { gte: cutoff },
        },
      }),
      prisma.dailyCogsItem.groupBy({
        by: ["date"],
        where: {
          storeId: store.id,
          date: { gte: cutoff },
        },
      }),
    ])

    const have = new Set(cogsDays.map((r) => dateKey(r.date)))
    const gaps = menuDays
      .map((r) => dateKey(r.date))
      .filter((d) => !have.has(d))
      .sort()

    if (gaps.length === 0) {
      console.log(`✓ ${store.name}: no gaps`)
      continue
    }

    const sample = gaps.slice(0, 10)
    results.push({
      storeId: store.id,
      storeName: store.name,
      totalGapDays: gaps.length,
      earliestGap: gaps[0] ?? null,
      latestGap: gaps[gaps.length - 1] ?? null,
      sampleDates: sample,
    })

    console.log(
      `✗ ${store.name}: ${gaps.length} gap day(s), ` +
        `${gaps[0]} … ${gaps[gaps.length - 1]}`
    )
    console.log(
      `  sample: ${sample.join(", ")}${gaps.length > sample.length ? ", …" : ""}`
    )
  }

  console.log("")
  if (results.length === 0) {
    console.log("All stores clean.")
  } else {
    const total = results.reduce((a, b) => a + b.totalGapDays, 0)
    console.log(
      `Total: ${total} gap day(s) across ${results.length} store(s)`
    )
  }
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import("../../src/lib/prisma")
    await prisma.$disconnect()
  })
