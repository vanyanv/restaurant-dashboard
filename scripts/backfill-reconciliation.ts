// scripts/backfill-reconciliation.ts
// One-shot historical backfill of actuals on the three forecast tables:
//   - ForecastDailyRevenue.actualRevenue   <- SUM(OtterDailySummary.fp/tpNetSales)
//   - ForecastHourlyOrders.actualOrders    <- OtterHourlySummary.orderCount
//   - ForecastMenuItem.actualQty           <- SUM(OtterMenuItem.fp/tpQuantitySold)
//
// Idempotent: filters on `reconciledAt IS NULL` so re-running is safe and
// only touches rows that still lack actuals. Run with:
//   pnpm tsx scripts/backfill-reconciliation.ts

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvLocal()

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl, ssl: true }),
})

function computeErrorPct(predicted: number, actual: number): number | null {
  if (actual === 0) return null
  return ((predicted - actual) / actual) * 100
}

async function backfillDailyRevenue(): Promise<void> {
  const stale = await prisma.forecastDailyRevenue.findMany({
    where: {
      reconciledAt: null,
      forecastDate: { lt: new Date() },
      hourBucket: 0,
    },
    select: {
      id: true,
      storeId: true,
      forecastDate: true,
      predictedRevenue: true,
    },
  })

  let written = 0
  for (const row of stale) {
    // OtterDailySummary has one row per (store, date, platform, paymentMethod),
    // so we aggregate net sales across all rows for the (store, date).
    const agg = await prisma.otterDailySummary.aggregate({
      where: { storeId: row.storeId, date: row.forecastDate },
      _sum: { fpNetSales: true, tpNetSales: true },
    })
    const fp = agg._sum.fpNetSales ?? 0
    const tp = agg._sum.tpNetSales ?? 0
    // Skip when there is no Otter coverage at all (both null sums collapse to 0,
    // but we want to distinguish "no rows" from "real $0 day"). Use _count.
    const presence = await prisma.otterDailySummary.count({
      where: { storeId: row.storeId, date: row.forecastDate },
    })
    if (presence === 0) continue

    const actual = fp + tp
    await prisma.forecastDailyRevenue.update({
      where: { id: row.id },
      data: {
        actualRevenue: actual,
        errorPct: computeErrorPct(row.predictedRevenue, actual),
        reconciledAt: new Date(),
      },
    })
    written++
  }
  console.log(`ForecastDailyRevenue: backfilled ${written}/${stale.length}`)
}

async function backfillHourlyOrders(): Promise<void> {
  const stale = await prisma.forecastHourlyOrders.findMany({
    where: {
      reconciledAt: null,
      forecastDate: { lt: new Date() },
    },
    select: {
      id: true,
      storeId: true,
      forecastDate: true,
      hourBucket: true,
      predictedOrders: true,
    },
  })

  let written = 0
  for (const row of stale) {
    const summary = await prisma.otterHourlySummary.findUnique({
      where: {
        storeId_date_hour: {
          storeId: row.storeId,
          date: row.forecastDate,
          hour: row.hourBucket,
        },
      },
      select: { orderCount: true },
    })

    let actual: number
    if (summary) {
      actual = summary.orderCount
    } else {
      // OtterHourlySummary does not insert zero rows for closed hours. If the
      // (store, date) has ANY hourly Otter coverage at all, the missing hour
      // is a real zero. If the date has no coverage, skip (Otter not synced).
      const dateCoverage = await prisma.otterHourlySummary.count({
        where: { storeId: row.storeId, date: row.forecastDate },
      })
      if (dateCoverage === 0) continue
      actual = 0
    }

    await prisma.forecastHourlyOrders.update({
      where: { id: row.id },
      data: {
        actualOrders: actual,
        errorPct: computeErrorPct(row.predictedOrders, actual),
        reconciledAt: new Date(),
      },
    })
    written++
  }
  console.log(`ForecastHourlyOrders: backfilled ${written}/${stale.length}`)
}

async function backfillMenuItem(): Promise<void> {
  const stale = await prisma.forecastMenuItem.findMany({
    where: {
      reconciledAt: null,
      forecastDate: { lt: new Date() },
    },
    select: {
      id: true,
      storeId: true,
      forecastDate: true,
      otterItemSkuId: true,
      predictedQty: true,
    },
  })

  let written = 0
  for (const row of stale) {
    // ForecastMenuItem.otterItemSkuId stores OtterMenuItem.itemName (see
    // ml/features/menu_item.py module docstring). OtterMenuItem has one
    // row per (store, date, category, itemName, isModifier); a single
    // item may appear under multiple categories, so we aggregate.
    const presence = await prisma.otterMenuItem.count({
      where: {
        storeId: row.storeId,
        date: row.forecastDate,
        itemName: row.otterItemSkuId,
        isModifier: false,
      },
    })
    if (presence === 0) continue

    const agg = await prisma.otterMenuItem.aggregate({
      where: {
        storeId: row.storeId,
        date: row.forecastDate,
        itemName: row.otterItemSkuId,
        isModifier: false,
      },
      _sum: { fpQuantitySold: true, tpQuantitySold: true },
    })
    const fp = agg._sum.fpQuantitySold ?? 0
    const tp = agg._sum.tpQuantitySold ?? 0
    const actual = fp + tp
    await prisma.forecastMenuItem.update({
      where: { id: row.id },
      data: {
        actualQty: actual,
        errorPct: computeErrorPct(row.predictedQty, actual),
        reconciledAt: new Date(),
      },
    })
    written++
  }
  console.log(`ForecastMenuItem: backfilled ${written}/${stale.length}`)
}

async function main(): Promise<void> {
  await backfillDailyRevenue()
  await backfillHourlyOrders()
  await backfillMenuItem()
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
