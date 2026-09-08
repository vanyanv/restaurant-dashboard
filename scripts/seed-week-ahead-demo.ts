/**
 * A demo week for `/dashboard/decisions` — DEV FIXTURE, NOT PRODUCTION DATA.
 *
 * The page reads eight tables the dev database has never held a row of:
 * `ForecastDailyRevenue`, `ForecastMenuItem`, `MlForecastEvaluation`,
 * `GrowthOpportunity`, `Recipe`, `OtterItemMapping`, `Invoice` and
 * `VendorLeadTime`. Every section therefore rendered its empty state, which
 * makes the page impossible to look at and impossible to check against the
 * design.
 *
 * This writes one plausible week so the surface can be seen and verified. It
 * is anchored on the REAL Otter sales already in the database — the forward
 * forecast is the trailing per-item average shaped by day of week, not an
 * invented curve — so the flat depletion rate the page compares against is
 * genuinely measured and only the forward half is fixture.
 *
 * Two guards, because this writes to whatever `DATABASE_URL` points at:
 *   - `ALLOW_DEMO_SEED=1` must be set.
 *   - the connection string must name a database with `dev` in it.
 *
 * Idempotent: every write is an upsert on the model's own unique key, so
 * running it twice leaves the same week rather than a second copy of it.
 */
import { prisma } from "@/lib/prisma"
import { weekStartUTC } from "@/lib/counter/week-window"
import { recomputeAccountVendorLeadTimes } from "@/lib/inventory/vendor-lead-time"
import { loadStoreInventoryContext, dailyDepletionRateFromContext } from "@/lib/inventory/store-inventory-context"

const MS_DAY = 86_400_000
const ACCOUNT = "acc_default_chrisneddys"
const MODEL_VERSION = "xgb-2026.09.04"

function ymd(d: Date) { return d.toISOString().slice(0, 10) }
function day(base: Date, n: number) { return new Date(base.getTime() + n * MS_DAY) }

/** Menu items to explode, and what one serving takes off the shelf. */
const RECIPES: Array<{ item: string; category: string; lines: Array<[string, number, string]> }> = [
  { item: "Eddy Way", category: "Burgers", lines: [
    ["Slider bun", 2, "each"], ["Ground chuck 80/20", 0.33, "lb"],
    ["American cheese", 0.02, "cs"], ["Tomato, slicing", 0.06, "lb"],
  ] },
  { item: "Chris Way", category: "Burgers", lines: [
    ["Slider bun", 2, "each"], ["Ground chuck 80/20", 0.33, "lb"], ["Boston lettuce", 0.02, "cs"],
  ] },
  { item: "2 Slider Combo", category: "Combos", lines: [
    ["Slider bun", 2, "each"], ["Ground chuck 80/20", 0.28, "lb"], ["Fryer oil", 0.01, "gal"],
  ] },
  { item: "1 Slider Combo", category: "Combos", lines: [
    ["Slider bun", 1, "each"], ["Ground chuck 80/20", 0.14, "lb"], ["Fryer oil", 0.01, "gal"],
  ] },
  { item: "Double Slider", category: "Burgers", lines: [
    ["Slider bun", 2, "each"], ["Ground chuck 80/20", 0.33, "lb"],
    ["American cheese", 0.02, "cs"], ["Tomato, slicing", 0.05, "lb"],
  ] },
  { item: "Single Slider", category: "Burgers", lines: [
    ["Slider bun", 1, "each"], ["Ground chuck 80/20", 0.17, "lb"],
    ["American cheese", 0.01, "cs"], ["Tomato, slicing", 0.03, "lb"],
  ] },
  { item: "Straight Cut Fries ", category: "Sides", lines: [
    ["Fryer oil", 0.012, "gal"],
  ] },
]

/** Ingredients this fixture needs beyond the six already on file. */
const EXTRA_INGREDIENTS: Array<{ name: string; recipeUnit: string; caseUnit: string; per: number }> = [
  { name: "Slider bun", recipeUnit: "each", caseUnit: "cs", per: 192 },
  { name: "Ground chuck 80/20", recipeUnit: "lb", caseUnit: "cs", per: 40 },
]

/** Vendor per ingredient — drives the lead-time read and the row's caption. */
const VENDOR: Record<string, string> = {
  "Slider bun": "Individual Foodservice",
  "Ground chuck 80/20": "Sysco Los Angeles",
  "American cheese": "Sysco Los Angeles",
  "Tomato, slicing": "Individual Foodservice",
}

/** Monday-first multipliers. Friday and Saturday carry the week. */
const DOW_SHAPE = [0.88, 0.82, 0.95, 1.02, 1.28, 1.16, 0.94]
/** How much busier the week ahead is than the trailing fortnight. */
const UPLIFT = 1.34

/** Target days of cover per ingredient, at the FORECAST-shaped rate. */
const TARGET_COVER: Record<string, number> = {
  "Slider bun": 1.8,
  "Ground chuck 80/20": 2.7,
  "American cheese": 4.1,
  "Tomato, slicing": 5.6,
}

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Refusing to run: set ALLOW_DEMO_SEED=1")
  }
  const url = process.env.DATABASE_URL ?? ""
  if (!/dev/i.test(url)) {
    throw new Error("Refusing to run: DATABASE_URL does not name a dev database")
  }

  const store = await prisma.store.findFirstOrThrow({
    where: { accountId: ACCOUNT, lifecycleStage: "ready" },
    select: { id: true, name: true, ownerId: true },
  })
  const owner = await prisma.user.findFirstOrThrow({
    where: { accountId: ACCOUNT }, select: { id: true },
  })
  const storeId = store.id
  const ownerId = owner.id

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const weekStart = weekStartUTC(today)
  console.log(`store=${store.name} today=${ymd(today)} weekStart=${ymd(weekStart)}`)

  /* ── 1. Ingredients ─────────────────────────────────────────────────── */
  for (const ing of EXTRA_INGREDIENTS) {
    await prisma.canonicalIngredient.upsert({
      where: { accountId_name: { accountId: ACCOUNT, name: ing.name } },
      update: { recipeUnit: ing.recipeUnit, caseUnit: ing.caseUnit, recipeUnitsPerCase: ing.per },
      create: {
        accountId: ACCOUNT, ownerId, name: ing.name, defaultUnit: ing.recipeUnit,
        recipeUnit: ing.recipeUnit, caseUnit: ing.caseUnit, recipeUnitsPerCase: ing.per,
        category: "Food",
      },
    })
  }
  // These already exist but with no pack, so every case-priced delivery of
  // them was dropped by `convertDelivered`.
  await prisma.canonicalIngredient.updateMany({
    where: { accountId: ACCOUNT, name: "American cheese" },
    data: { caseUnit: "cs", recipeUnitsPerCase: 1 },
  })
  await prisma.canonicalIngredient.updateMany({
    where: { accountId: ACCOUNT, name: "Tomato, slicing" },
    data: { caseUnit: "cs", recipeUnitsPerCase: 25 },
  })
  const ingredients = await prisma.canonicalIngredient.findMany({
    where: { accountId: ACCOUNT },
    select: { id: true, name: true, recipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true },
  })
  const ingByName = new Map(ingredients.map((i) => [i.name, i]))

  /* ── 2. Recipes and their Otter mappings ────────────────────────────── */
  //
  // Sweep first. Re-running after editing RECIPES used to leave the previous
  // run's recipes, mappings and forecast rows behind, so an item removed from
  // the fixture kept its forward demand and its ingredient went on outranking
  // the real ones in "What you will run out of" — with a flat rate of nothing,
  // because no such item has ever been sold.
  const keptItems = RECIPES.map((r) => r.item)
  await prisma.otterItemMapping.deleteMany({ where: { storeId, otterItemName: { notIn: keptItems } } })
  await prisma.forecastMenuItem.deleteMany({ where: { storeId, otterItemSkuId: { notIn: keptItems } } })
  const staleRecipes = await prisma.recipe.findMany({
    where: { accountId: ACCOUNT, itemName: { notIn: keptItems } },
    select: { id: true },
  })
  if (staleRecipes.length > 0) {
    const ids = staleRecipes.map((r) => r.id)
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: { in: ids } } })
    await prisma.recipe.deleteMany({ where: { id: { in: ids } } })
  }

  const recipeIdByItem = new Map<string, string>()
  for (const r of RECIPES) {
    const recipe = await prisma.recipe.upsert({
      where: { accountId_itemName_category: { accountId: ACCOUNT, itemName: r.item, category: r.category } },
      update: {},
      create: { accountId: ACCOUNT, ownerId, itemName: r.item, category: r.category, servingSize: 1, isConfirmed: true },
      select: { id: true },
    })
    recipeIdByItem.set(r.item, recipe.id)
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    for (const [name, qty, unit] of r.lines) {
      const ing = ingByName.get(name)
      if (!ing) throw new Error(`missing ingredient ${name}`)
      await prisma.recipeIngredient.create({
        data: { recipeId: recipe.id, canonicalIngredientId: ing.id, quantity: qty, unit },
      })
    }
    await prisma.otterItemMapping.upsert({
      where: { storeId_otterItemName: { storeId, otterItemName: r.item } },
      update: { recipeId: recipe.id },
      create: { storeId, otterItemName: r.item, recipeId: recipe.id },
    })
  }
  console.log(`recipes: ${recipeIdByItem.size}`)

  /* ── 3. Invoices — deliveries, and the cadence lead time is read from ── */
  //
  // Sized from the ingredient's OWN measured usage, not a flat two cases.
  // A fixed quantity delivers a nine-week supply of tomatoes alongside two
  // days of buns, and on-hand then has nothing to do with the shelf: the
  // tomato row wanted 57 lb of cover and the deliveries alone put 250 lb
  // behind the count, which clamped its counted quantity to 1 and printed a
  // 39-day flat cover on a page arguing about three-day ones.
  //
  // The rate comes from the recipes above against real trailing sales, so it
  // needs no invoices and no count — which is why this reads the context
  // BEFORE either exists.
  await prisma.stockCount.deleteMany({ where: { id: "demo-week-ahead-count" } })
  const usageCtx = await loadStoreInventoryContext({ storeId, accountId: ACCOUNT, asOf: today })
  const casesPerDrop = new Map<string, number>()
  for (const name of Object.keys(VENDOR)) {
    const ing = ingByName.get(name)
    if (!ing) continue
    const rate = dailyDepletionRateFromContext(usageCtx, ing).ratePerDay
    const perCase = ing.recipeUnitsPerCase ?? 1
    /*
     * Two days of trade a drop, which is the cadence these invoices carry —
     * and FRACTIONAL, because rounding up to a whole case is what broke this
     * the first time. A 25 lb case of tomatoes is very nearly four days of
     * trade at this store, so a one-case minimum delivers twice what gets
     * used and the shelf grows without limit between counts.
     */
    casesPerDrop.set(name, Math.max(0.05, Number(((rate * 2) / perCase).toFixed(2))))
  }

  const vendors = [...new Set(Object.values(VENDOR))]
  for (const vendor of vendors) {
    for (let w = 0; w < 12; w++) {
      const invoiceDate = day(today, -(w * 2 + 2))
      const id = `demo-${vendor.replace(/\W+/g, "-")}-${ymd(invoiceDate)}`
      const lines = Object.entries(VENDOR)
        .filter(([, v]) => v === vendor)
        .map(([name], i) => {
          const ing = ingByName.get(name)!
          const cases = casesPerDrop.get(name) ?? 1
          return {
            lineNumber: i + 1,
            productName: name,
            quantity: cases,
            unit: "CS",
            unitPrice: 48,
            extendedPrice: 48 * cases,
            canonicalIngredientId: ing.id,
            matchSource: "sku",
            matchedAt: invoiceDate,
          }
        })
      // `deleteMany` first: an upsert's `update` leaves existing lineItems
      // alone, so an ingredient added to VENDOR after a previous run kept no
      // line and read "NO VENDOR · LEAD 3D" on the page.
      await prisma.invoiceLineItem.deleteMany({ where: { invoice: { emailMessageId: id } } })
      await prisma.invoice.upsert({
        where: { emailMessageId: id },
        update: { invoiceDate, lineItems: { create: lines } },
        create: {
          emailMessageId: id, ownerId, accountId: ACCOUNT, storeId,
          vendorName: vendor, invoiceNumber: id.slice(-12), invoiceDate,
          totalAmount: lines.reduce((t, l) => t + l.extendedPrice, 0),
          status: "MATCHED", matchedAt: invoiceDate,
          lineItems: { create: lines },
        },
      })
    }
  }
  const lead = await recomputeAccountVendorLeadTimes(ACCOUNT)
  console.log(`invoices seeded; lead times: ${JSON.stringify(lead)}`)

  /* ── 4. The week's revenue forecast, with band, actuals and waterfall ── */
  const trailing = await prisma.otterMenuItem.aggregate({
    where: { storeId, date: { gte: day(today, -28), lt: today } },
    _sum: { fpTotalSales: true, tpTotalSales: true },
  })
  const trailingDaily =
    ((trailing._sum.fpTotalSales ?? 0) + (trailing._sum.tpTotalSales ?? 0)) / 28 || 6200
  const base = Math.round(trailingDaily)
  console.log(`trailing daily revenue: ${base}`)

  const generatedAt = new Date(weekStart.getTime() - MS_DAY)
  // Monday..Sunday of this week, plus the next seven so the forward window
  // `getRevenueForecast` asks for is never short.
  for (let i = 0; i < 14; i++) {
    const d = day(weekStart, i)
    const dow = (d.getUTCDay() + 6) % 7
    const shape = DOW_SHAPE[dow]
    const predicted = Math.round(base * shape * UPLIFT)
    const settled = d.getTime() < today.getTime()
    // The band widens with the horizon, which is what a conformal interval
    // measured per horizon-day actually does.
    const out = Math.max(0, Math.round((d.getTime() - today.getTime()) / MS_DAY))
    const halfWidth = predicted * (0.09 + out * 0.012)
    const weather = Math.round(predicted * (dow >= 4 ? 0.05 : -0.03))
    const event = dow === 4 || dow === 5 ? Math.round(predicted * 0.07) : 0
    const dowEffect = Math.round(predicted * (shape - 1))
    const baseValue = predicted - weather - event - dowEffect
    await prisma.forecastDailyRevenue.upsert({
      where: {
        storeId_forecastDate_hourBucket_generatedAt: {
          storeId, forecastDate: d, hourBucket: 0, generatedAt,
        },
      },
      update: {},
      create: {
        storeId, forecastDate: d, hourBucket: 0, generatedAt,
        predictedRevenue: predicted,
        p10: Math.round(predicted - halfWidth),
        p90: Math.round(predicted + halfWidth),
        modelVersion: MODEL_VERSION,
        actualRevenue: settled ? Math.round(predicted * (0.93 + ((i * 37) % 11) / 100)) : null,
        reconciledAt: settled ? day(d, 1) : null,
        reconciliationMethod: settled ? "MinTrace" : null,
        attribution: {
          base: baseValue,
          groups: [
            { label: "Day of week", value: dowEffect },
            { label: "Weather", value: weather },
            ...(event !== 0 ? [{ label: "Nearby events", value: event }] : []),
          ],
        },
      },
    })
  }
  console.log("forecastDailyRevenue: 14 days")

  /* ── 5. Per-item demand, which is what shapes depletion ─────────────── */
  const perItemTrailing = await prisma.otterMenuItem.groupBy({
    by: ["itemName"],
    where: { storeId, itemName: { in: RECIPES.map((r) => r.item) }, date: { gte: day(today, -28), lt: today } },
    _sum: { fpQuantitySold: true, tpQuantitySold: true },
  })
  const dailyQty = new Map(
    perItemTrailing.map((r) => [
      r.itemName,
      ((r._sum.fpQuantitySold ?? 0) + (r._sum.tpQuantitySold ?? 0)) / 28,
    ]),
  )
  // Every recipe above maps to an item the store actually sells, so this is
  // a guard rather than a fixture: an item with no trailing volume gets the
  // median rather than zero, so a rename upstream degrades instead of
  // silently removing a whole ingredient's forward demand.
  const median = [...dailyQty.values()].sort((a, b) => a - b)[Math.floor(dailyQty.size / 2)] ?? 20
  for (const r of RECIPES) if (!dailyQty.has(r.item)) dailyQty.set(r.item, median)

  for (const r of RECIPES) {
    const perDay = dailyQty.get(r.item) ?? 0
    if (perDay <= 0) continue
    for (let i = 0; i < 14; i++) {
      const d = day(today, i)
      const dow = (d.getUTCDay() + 6) % 7
      const qty = perDay * DOW_SHAPE[dow] * UPLIFT
      await prisma.forecastMenuItem.upsert({
        where: {
          storeId_otterItemSkuId_forecastDate_generatedAt: {
            storeId, otterItemSkuId: r.item, forecastDate: d, generatedAt,
          },
        },
        update: { predictedQty: qty },
        create: {
          storeId, otterItemSkuId: r.item, forecastDate: d, generatedAt,
          predictedQty: qty,
          p10: qty * 0.86, p90: qty * 1.14,
          modelVersion: MODEL_VERSION,
        },
      })
    }
  }
  console.log(`forecastMenuItem: ${RECIPES.length} items × 14 days`)

  /* ── 6. The scorecard ───────────────────────────────────────────────── */
  await prisma.mlForecastEvaluation.upsert({
    where: {
      target_storeId_modelVersion_horizonDay_windowStart_windowEnd: {
        target: "REVENUE", storeId, modelVersion: MODEL_VERSION, horizonDay: 0,
        windowStart: day(today, -42), windowEnd: day(today, -1),
      },
    },
    update: {},
    create: {
      target: "REVENUE", storeId, modelVersion: MODEL_VERSION, horizonDay: 0,
      windowStart: day(today, -42), windowEnd: day(today, -1),
      wape: 0.062, mape: 0.071, mae: 402, bias: 0.014,
      intervalCoverage80: 0.81, intervalCoverage95: 0.95,
      baselineWape: 0.114, sampleSize: 42, staleRowCount: 0,
    },
  })

  /* ── 7. The queue ───────────────────────────────────────────────────── */
  const OPPS = [
    { type: "reprice" as const, title: "Raise Eddy Way to $14.25", impact: 812, horizon: 1,
      conf: "high" as const, p10: 480, p25: 604, p90: 1140,
      action: "Inelastic at −0.42 on 1,180 units in 30 days. A 75¢ rise loses about 31 units." },
    { type: "channel_mix" as const, title: "Push Thursday off DoorDash", impact: 399, horizon: 7,
      conf: "medium" as const, p10: 150, p25: 210, p90: 688,
      action: "Nets $6.18 an order against $9.40 in-house; Thursday runs 34% third-party." },
    { type: "food_cost_risk" as const, title: "Chicken thigh drifting 11%", impact: -268, horizon: 7,
      conf: "low" as const, p10: -80, p25: -104, p90: -515,
      action: "Three IFS invoices over the 8-week median. Puts Saturday's food cost at 31.4%." },
    { type: "menu_engineering" as const, title: "Drop Loaded Fries", impact: 640, horizon: 30,
      conf: "medium" as const, p10: 240, p25: 320, p90: 980,
      action: "Bottom decile on contribution and on volume for six weeks running." },
    { type: "profit_risk" as const, title: "Sunday close is running two hours long", impact: 402, horizon: 7,
      conf: "medium" as const, p10: 180, p25: 240, p90: 610,
      action: "Last order lands 21:12 on average against a 22:00 close." },
  ]
  for (const o of OPPS) {
    await prisma.growthOpportunity.upsert({
      where: {
        storeId_asOfDate_opportunityType_title: {
          storeId, asOfDate: today, opportunityType: o.type, title: o.title,
        },
      },
      update: {},
      create: {
        storeId, asOfDate: today, opportunityType: o.type, title: o.title,
        estimatedDollarImpact: o.impact, impactP10: o.p10, impactP25: o.p25, impactP90: o.p90,
        horizonDays: o.horizon, confidence: o.conf, suggestedAction: o.action, evidence: [],
      },
    })
  }
  console.log(`growthOpportunity: ${OPPS.length}`)

  /* ── 8. The count, sized so the shelf shows a spread of verdicts ─────── */
  //
  // The count sits SIXTEEN days back on purpose. `depletionWindow` takes
  // `max(asOf - lookback, countedAt)`, so an anchor inside the fourteen-day
  // lookback shortens the flat window to whatever is left of it — put the
  // count yesterday and the "14-day trailing average" is one day of trade,
  // which is not the number this page is arguing about. Sixteen days back
  // leaves the flat read its full window while still giving `onHand` a real
  // anchor to walk forward from.
  //
  // Two passes, and the second one is exact rather than iterative: `onHand` is
  // `baseQty + deliveries − depletion − adjustments`, so it is LINEAR in the
  // counted quantity. Measure it once with a placeholder, and the correction
  // is the difference.
  const countedAt = new Date(day(today, -16).getTime() + 12 * 3600_000)
  const { computeForecastShapedDepletion } = await import("@/lib/inventory/forecast-depletion")
  const { runningOnHandFromContext: onHandOf } = await import("@/lib/inventory/store-inventory-context")
  const shaped = await computeForecastShapedDepletion({
    accountId: ACCOUNT, storeIds: [storeId],
    ingredientIds: ingredients.map((i) => i.id), from: today, days: 14,
  })

  const count = await prisma.stockCount.upsert({
    where: { id: "demo-week-ahead-count" },
    // Deleted in step 3 so the usage read has no anchor; recreated here.
    update: { countedAt, completedAt: countedAt, startedAt: countedAt, status: "COMPLETED" },
    create: {
      id: "demo-week-ahead-count", storeId, countedByUserId: ownerId,
      status: "COMPLETED", startedAt: countedAt, countedAt,
      completedAt: countedAt, note: "Demo fixture — seed-week-ahead-demo.ts",
    },
    select: { id: true },
  })

  const tracked = Object.keys(TARGET_COVER)
    .map((n) => ingByName.get(n))
    .filter((i): i is NonNullable<typeof i> => i != null)

  // Lines for ingredients the fixture no longer tracks, gone — the count is
  // the anchor every cover figure is walked forward from, so a line left
  // behind is an ingredient that goes on appearing with no rate behind it.
  await prisma.stockCountLine.deleteMany({
    where: { stockCountId: count.id, canonicalIngredientId: { notIn: tracked.map((t) => t.id) } },
  })

  // Pass one: a placeholder, so `onHand` can be measured against something.
  const PLACEHOLDER = 1000
  for (const ing of tracked) {
    await prisma.stockCountLine.upsert({
      where: { stockCountId_canonicalIngredientId: { stockCountId: count.id, canonicalIngredientId: ing.id } },
      update: { qtyInRecipeUnit: PLACEHOLDER },
      create: { stockCountId: count.id, canonicalIngredientId: ing.id, qtyInRecipeUnit: PLACEHOLDER },
    })
  }

  const ctx = await loadStoreInventoryContext({ storeId, accountId: ACCOUNT, asOf: new Date() })
  for (const ing of tracked) {
    const cover = TARGET_COVER[ing.name]
    const s = shaped.get(ing.id)
    if (!s || s.totalQty <= 0) { console.log(`  ${ing.name}: no forecast demand, skipped`); continue }

    // The quantity that produces exactly `cover` days at the forecast-shaped
    // rate — the series consumed day by day, the last day part-consumed.
    let want = 0
    let left = cover
    for (const d of s.days) {
      if (left <= 0) break
      want += d.qty * Math.min(1, left)
      left -= 1
    }

    const measured = onHandOf(ctx, ing).onHand
    const qty = PLACEHOLDER + (want - measured)
    if (qty <= 0) {
      // The deliveries alone already exceed the target cover, so no counted
      // quantity produces it. Say so rather than clamping to 1 and printing a
      // cover figure that is four times what the fixture asked for.
      console.log(`  ${ing.name}: SKIPPED — deliveries since the count already exceed ${cover}d of cover`)
      continue
    }
    await prisma.stockCountLine.update({
      where: { stockCountId_canonicalIngredientId: { stockCountId: count.id, canonicalIngredientId: ing.id } },
      data: { qtyInRecipeUnit: qty },
    })
    const flat = dailyDepletionRateFromContext(ctx, ing)
    console.log(
      `  ${ing.name}: flat ${flat.ratePerDay.toFixed(2)}/d over ${flat.windowDays}d, ` +
      `forecast ${s.meanPerDay.toFixed(2)}/d, on-hand ${want.toFixed(1)} ${ing.recipeUnit} ` +
      `→ cover flat ${(want / (flat.ratePerDay || Infinity)).toFixed(1)}d / forecast ${cover}d`,
    )
  }

  console.log("done")
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
