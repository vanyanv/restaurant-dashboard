/**
 * Smoke test for the v1 chat tool surface. Loops every tool against the
 * dev Neon branch (DATABASE_URL2) using the demo owner. Asserts each call
 * resolves, prints a small summary, and confirms owner-scope rejection on
 * a foreign storeId.
 *
 * Run: npx tsx --env-file=.env.local scripts/chat-smoke/test-tools.ts
 */

// tsx runs as CJS, so top-level await isn't allowed. We override
// DATABASE_URL with DATABASE_URL2 BEFORE the prisma module is imported by
// loading those modules dynamically inside main().
if (process.env.DATABASE_URL2) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

type ChatToolContext = import("../../src/lib/chat/tools").ChatToolContext

function header(label: string) {
  console.log(`\n=== ${label} ===`)
}

function preview(value: unknown, max = 3) {
  if (Array.isArray(value)) {
    const slice = value.slice(0, max)
    return JSON.stringify(slice, null, 2) + (value.length > max ? `\n  …+${value.length - max} more` : "")
  }
  return JSON.stringify(value, null, 2)
}

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { chatTools } = await import("../../src/lib/chat/tools")
  const { OwnerScopeError } = await import("../../src/lib/chat/owner-scope")

  const owner = await prisma.user.findFirst({
    where: { ownedStores: { some: {} } },
    select: { id: true, email: true },
  })
  if (!owner) throw new Error("no owner with stores found")
  console.log(`owner: ${owner.email}`)

  const ctx: ChatToolContext = { ownerId: owner.id, prisma }

  // 1. listStores
  header("listStores")
  const stores = await chatTools.listStores.execute({}, ctx)
  console.log(`stores: ${stores.length}`)
  console.log(preview(stores))
  if (stores.length === 0) throw new Error("expected at least 1 store")

  const storeIds = stores.map((s) => s.id)

  // Pick a date window with data — last 90 days, the existing OtterDailySummary
  // / OtterHourlySummary / DailyCogsItem rollups all live there.
  const today = new Date()
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  const dateRange = {
    from: ninetyDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  }
  console.log(`dateRange: ${dateRange.from} → ${dateRange.to}`)

  // 2. getDailySales by day
  header("getDailySales (groupBy=day)")
  const daily = await chatTools.getDailySales.execute(
    { storeIds, dateRange, groupBy: "day" },
    ctx,
  )
  console.log(`rows: ${daily.length}`)
  console.log(preview(daily))

  // 3. getDailySales by platform
  header("getDailySales (groupBy=platform)")
  const dailyPlat = await chatTools.getDailySales.execute(
    { storeIds, dateRange, groupBy: "platform" },
    ctx,
  )
  console.log(preview(dailyPlat))

  // 4. getHourlyTrend
  header("getHourlyTrend (no dayOfWeek)")
  const hourly = await chatTools.getHourlyTrend.execute(
    { storeIds, dateRange },
    ctx,
  )
  console.log(`rows: ${hourly.length}`)
  console.log(preview(hourly, 5))

  header("getHourlyTrend (Saturday only)")
  const hourlySat = await chatTools.getHourlyTrend.execute(
    { storeIds, dateRange, dayOfWeek: 6 },
    ctx,
  )
  console.log(`rows: ${hourlySat.length}`)

  // 5. getPlatformBreakdown
  header("getPlatformBreakdown")
  const plat = await chatTools.getPlatformBreakdown.execute(
    { storeIds, dateRange },
    ctx,
  )
  console.log(preview(plat))

  // 6. getCogsByItem
  header("getCogsByItem topN=5")
  const cogs = await chatTools.getCogsByItem.execute(
    { storeIds, dateRange, topN: 5 },
    ctx,
  )
  console.log(preview(cogs))

  // 7. getMenuPrices
  header("getMenuPrices itemQuery=shake")
  const menuPrices = await chatTools.getMenuPrices.execute(
    { storeIds, itemQuery: "shake" },
    ctx,
  )
  console.log(`rows: ${menuPrices.length}`)
  console.log(preview(menuPrices))

  // 8. searchMenuItems
  header("searchMenuItems query='vanilla ice cream'")
  const menuSearch = await chatTools.searchMenuItems.execute(
    { query: "vanilla ice cream", storeIds, limit: 5 },
    ctx,
  )
  console.log(preview(menuSearch))

  // 9. getIngredientPrices
  header("getIngredientPrices query=cheese")
  const ingredients = await chatTools.getIngredientPrices.execute(
    { query: "cheese", storeIds, limit: 5 },
    ctx,
  )
  console.log(preview(ingredients))

  // 10. searchInvoices
  header("searchInvoices query='chicken thighs'")
  const invoiceHits = await chatTools.searchInvoices.execute(
    { query: "chicken thighs", storeIds, limit: 5 },
    ctx,
  )
  console.log(preview(invoiceHits))

  // 11. sumInvoiceLines on top-3 from the prior search (when present)
  if (invoiceHits.length > 0) {
    header("sumInvoiceLines on top searchInvoices hits")
    const lineIds = invoiceHits
      .filter((r) => r.lineId)
      .slice(0, 3)
      .map((r) => r.lineId)
    if (lineIds.length === 0) {
      console.log("no resolvable lineIds in search results — skipping sum")
    } else {
      const sum = await chatTools.sumInvoiceLines.execute({ lineIds }, ctx)
      console.log(preview(sum))
    }
  }

  // Owner-scope tripwire: a foreign storeId should reject every scoped tool.
  header("owner-scope tripwire: foreign storeId rejected")
  try {
    await chatTools.getDailySales.execute(
      {
        storeIds: ["clxfakefakefakefakefake000000"],
        dateRange,
      },
      ctx,
    )
    throw new Error("FAIL: getDailySales should have rejected foreign id")
  } catch (err) {
    if (err instanceof OwnerScopeError && err.code === "STORE_NOT_OWNED") {
      console.log(`ok — threw ${err.code}`)
    } else {
      throw err
    }
  }

  console.log("\nall tools ok")
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
