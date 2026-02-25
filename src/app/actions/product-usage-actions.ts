"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import OpenAI from "openai"
import type {
  ProductUsageData,
  RecipeWithIngredients,
  RecipeInput,
  IngredientUsageRow,
  MenuItemCostRow,
  CategorySummaryRow,
  VendorPriceTrend,
  PriceAlert,
  OrderAnomaly,
  ProductUsageKpis,
  MenuItemForRecipeBuilder,
  DemandForecast,
  AnomalyExplanation,
} from "@/types/product-usage"

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required")
  return new OpenAI({ apiKey, timeout: 60_000 })
}

// ─── 1. Main read action ───

export async function getProductUsageData(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<ProductUsageData | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const { storeId, days = 30, startDate: startStr, endDate: endStr } = options ?? {}

  let startDate: Date, endDate: Date
  if (startStr && endStr) {
    startDate = new Date(startStr + "T00:00:00")
    endDate = new Date(endStr + "T23:59:59")
  } else {
    endDate = new Date()
    startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
  }

  // Get all stores for the owner
  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return null

  const targetStoreIds = storeId ? [storeId] : storeIds

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhere: any = {
    ownerId: session.user.id,
    invoiceDate: { gte: startDate, lte: endDate },
  }
  if (storeId) invoiceWhere.storeId = storeId

  // Parallel queries
  const [lineItems, menuItems, recipes, aliases, allTimeLineItems] =
    await Promise.all([
      // Invoice line items for the date range
      prisma.invoiceLineItem.findMany({
        where: { invoice: invoiceWhere },
        select: {
          productName: true,
          category: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          extendedPrice: true,
          invoiceId: true,
          invoice: {
            select: {
              vendorName: true,
              invoiceDate: true,
            },
          },
        },
      }),
      // Otter menu items for the date range
      prisma.otterMenuItem.findMany({
        where: {
          storeId: storeId ? storeId : { in: storeIds },
          date: { gte: startDate, lte: endDate },
        },
      }),
      // All recipes with ingredients for the stores
      prisma.recipe.findMany({
        where: { storeId: { in: targetStoreIds } },
        include: {
          ingredients: {
            select: {
              id: true,
              ingredientName: true,
              quantity: true,
              unit: true,
              notes: true,
            },
          },
        },
      }),
      // All ingredient aliases for the stores
      prisma.ingredientAlias.findMany({
        where: { storeId: { in: targetStoreIds } },
      }),
      // All-time line items for anomaly detection (new product check)
      prisma.invoiceLineItem.findMany({
        where: {
          invoice: { ownerId: session.user.id },
        },
        select: {
          productName: true,
          quantity: true,
          invoice: {
            select: {
              invoiceDate: true,
              vendorName: true,
            },
          },
        },
      }),
    ])

  // Build alias lookup: rawName → { canonicalName, conversionFactor, toUnit }
  const aliasMap = new Map<
    string,
    { canonicalName: string; conversionFactor: number; toUnit: string }
  >()
  for (const alias of aliases) {
    aliasMap.set(alias.rawName.toLowerCase(), {
      canonicalName: alias.canonicalName,
      conversionFactor: alias.conversionFactor,
      toUnit: alias.toUnit,
    })
  }

  // ── Build purchased map ──
  // canonicalName → { purchasedQty (in recipe units), totalCost, unitCosts, invoiceIds, category, unit }
  const purchasedMap = new Map<
    string,
    {
      purchasedQty: number
      totalCost: number
      invoiceIds: Set<string>
      category: string | null
      unit: string
    }
  >()

  for (const li of lineItems) {
    const rawName = li.productName.toLowerCase()
    const alias = aliasMap.get(rawName)
    const canonicalName = alias ? alias.canonicalName : li.productName
    const convertedQty = alias
      ? li.quantity * alias.conversionFactor
      : li.quantity
    const unit = alias ? alias.toUnit : li.unit ?? "unit"

    const existing = purchasedMap.get(canonicalName)
    if (existing) {
      existing.purchasedQty += convertedQty
      existing.totalCost += li.extendedPrice
      existing.invoiceIds.add(li.invoiceId)
    } else {
      purchasedMap.set(canonicalName, {
        purchasedQty: convertedQty,
        totalCost: li.extendedPrice,
        invoiceIds: new Set([li.invoiceId]),
        category: li.category,
        unit,
      })
    }
  }

  // ── Build recipe lookup ──
  // key: `${itemName}:::${category}` → recipe with ingredients
  const recipeMap = new Map<
    string,
    (typeof recipes)[number]
  >()
  for (const recipe of recipes) {
    recipeMap.set(`${recipe.itemName}:::${recipe.category}`, recipe)
  }

  // ── Aggregate menu item sales ──
  // key: `${itemName}:::${category}` → { totalQtySold, totalSalesRevenue }
  const menuSalesMap = new Map<
    string,
    { totalQtySold: number; totalSalesRevenue: number }
  >()
  for (const mi of menuItems) {
    const key = `${mi.itemName}:::${mi.category}`
    const qtySold = mi.fpQuantitySold + mi.tpQuantitySold
    const salesRevenue = mi.fpTotalSales + mi.tpTotalSales
    const existing = menuSalesMap.get(key)
    if (existing) {
      existing.totalQtySold += qtySold
      existing.totalSalesRevenue += salesRevenue
    } else {
      menuSalesMap.set(key, {
        totalQtySold: qtySold,
        totalSalesRevenue: salesRevenue,
      })
    }
  }

  // ── Compute theoretical usage per ingredient ──
  // canonicalIngredientName → theoreticalQty
  const theoreticalMap = new Map<string, number>()

  for (const [menuKey, sales] of menuSalesMap) {
    const recipe = recipeMap.get(menuKey)
    if (!recipe) continue

    for (const ing of recipe.ingredients) {
      const theoreticalQty = sales.totalQtySold * ing.quantity
      theoreticalMap.set(
        ing.ingredientName,
        (theoreticalMap.get(ing.ingredientName) ?? 0) + theoreticalQty
      )
    }
  }

  // ── Build ingredient usage rows ──
  const allIngredientNames = new Set([
    ...purchasedMap.keys(),
    ...theoreticalMap.keys(),
  ])

  const ingredientUsage: IngredientUsageRow[] = []
  for (const name of allIngredientNames) {
    const purchased = purchasedMap.get(name)
    const theoretical = theoreticalMap.get(name) ?? 0

    const purchasedQty = purchased?.purchasedQty ?? 0
    const purchasedCost = purchased?.totalCost ?? 0
    const avgUnitCost = purchasedQty > 0 ? purchasedCost / purchasedQty : 0
    const invoiceCount = purchased?.invoiceIds.size ?? 0
    const unit = purchased?.unit ?? "unit"
    const category = purchased?.category ?? null

    const varianceQuantity = purchasedQty - theoretical
    const variancePct =
      theoretical > 0 ? ((purchasedQty - theoretical) / theoretical) * 100 : 0
    const wasteEstimatedCost =
      varianceQuantity > 0 ? varianceQuantity * avgUnitCost : 0

    let status: IngredientUsageRow["status"]
    if (theoretical === 0) {
      status = "no_recipe"
    } else if (variancePct > 10) {
      status = "over_ordered"
    } else if (variancePct < -10) {
      status = "under_ordered"
    } else {
      status = "balanced"
    }

    ingredientUsage.push({
      ingredientName: name,
      canonicalName: name,
      category,
      purchasedQuantity: purchasedQty,
      purchasedUnit: unit,
      purchasedCost,
      avgUnitCost,
      invoiceCount,
      theoreticalUsage: theoretical,
      varianceQuantity,
      variancePct,
      wasteEstimatedCost,
      status,
    })
  }

  // ── Build menu item cost rows ──
  const menuItemCosts: MenuItemCostRow[] = []
  for (const [menuKey, sales] of menuSalesMap) {
    const [itemName, category] = menuKey.split(":::")
    const recipe = recipeMap.get(menuKey)
    const hasRecipe = !!recipe

    let theoreticalCOGS = 0
    if (recipe) {
      for (const ing of recipe.ingredients) {
        const purchased = purchasedMap.get(ing.ingredientName)
        const avgCost = purchased
          ? purchased.totalCost / purchased.purchasedQty
          : 0
        theoreticalCOGS += sales.totalQtySold * ing.quantity * avgCost
      }
    }

    const grossProfitEstimate = sales.totalSalesRevenue - theoreticalCOGS
    const grossMarginPct =
      sales.totalSalesRevenue > 0
        ? (grossProfitEstimate / sales.totalSalesRevenue) * 100
        : null

    menuItemCosts.push({
      itemName,
      category,
      totalQuantitySold: sales.totalQtySold,
      totalSalesRevenue: sales.totalSalesRevenue,
      theoreticalCOGS,
      grossProfitEstimate,
      grossMarginPct,
      hasRecipe,
    })
  }

  // ── Build category summary ──
  const categoryMap = new Map<
    string,
    { purchasedCost: number; theoreticalCost: number }
  >()
  for (const row of ingredientUsage) {
    const cat = row.category ?? "Other"
    const existing = categoryMap.get(cat)
    const theoreticalCost = row.theoreticalUsage * row.avgUnitCost
    if (existing) {
      existing.purchasedCost += row.purchasedCost
      existing.theoreticalCost += theoreticalCost
    } else {
      categoryMap.set(cat, {
        purchasedCost: row.purchasedCost,
        theoreticalCost,
      })
    }
  }
  const categoryBreakdown: CategorySummaryRow[] = Array.from(
    categoryMap.entries()
  ).map(([category, data]) => {
    const varianceCost = data.purchasedCost - data.theoreticalCost
    const variancePct =
      data.theoreticalCost > 0
        ? ((data.purchasedCost - data.theoreticalCost) / data.theoreticalCost) *
          100
        : 0
    return {
      category,
      purchasedCost: data.purchasedCost,
      theoreticalUsageCost: data.theoreticalCost,
      varianceCost,
      variancePct,
    }
  })

  // ── Compute price alerts ──
  // Compare latest invoice unit price per product against 30-day trailing avg
  const priceAlerts: PriceAlert[] = []
  const productPriceHistory = new Map<
    string,
    { prices: { date: Date; price: number }[]; category: string | null }
  >()

  for (const li of lineItems) {
    const invoiceDate = li.invoice.invoiceDate
    if (!invoiceDate) continue
    const existing = productPriceHistory.get(li.productName)
    if (existing) {
      existing.prices.push({ date: invoiceDate, price: li.unitPrice })
    } else {
      productPriceHistory.set(li.productName, {
        prices: [{ date: invoiceDate, price: li.unitPrice }],
        category: li.category,
      })
    }
  }

  for (const [productName, data] of productPriceHistory) {
    if (data.prices.length < 2) continue

    // Sort by date
    data.prices.sort((a, b) => a.date.getTime() - b.date.getTime())
    const latestPrice = data.prices[data.prices.length - 1].price

    // Trailing avg (exclude the latest)
    const trailing = data.prices.slice(0, -1)
    if (trailing.length === 0) continue
    const trailingAvg =
      trailing.reduce((sum, p) => sum + p.price, 0) / trailing.length

    if (trailingAvg === 0) continue
    const changePercent =
      ((latestPrice - trailingAvg) / trailingAvg) * 100

    // Only alert on significant changes (>15%)
    if (Math.abs(changePercent) < 15) continue

    let severity: PriceAlert["severity"]
    if (changePercent > 50) {
      severity = "spike"
    } else if (changePercent > 0) {
      severity = "increase"
    } else {
      severity = "decrease"
    }

    const direction = changePercent > 0 ? "increased" : "decreased"
    priceAlerts.push({
      productName,
      category: data.category,
      previousAvgPrice: trailingAvg,
      currentPrice: latestPrice,
      changePercent,
      severity,
      message: `${productName} price ${direction} by ${Math.abs(changePercent).toFixed(1)}% (from $${trailingAvg.toFixed(2)} to $${latestPrice.toFixed(2)})`,
    })
  }

  // Sort alerts by absolute change percent descending
  priceAlerts.sort(
    (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)
  )

  // ── Compute order anomalies ──
  const orderAnomalies: OrderAnomaly[] = []

  // Build all-time product history for new product detection
  const allTimeProducts = new Map<
    string,
    { firstSeen: Date; quantities: number[] }
  >()
  for (const li of allTimeLineItems) {
    const date = li.invoice.invoiceDate
    if (!date) continue
    const existing = allTimeProducts.get(li.productName)
    if (existing) {
      if (date < existing.firstSeen) existing.firstSeen = date
      existing.quantities.push(li.quantity)
    } else {
      allTimeProducts.set(li.productName, {
        firstSeen: date,
        quantities: [li.quantity],
      })
    }
  }

  // Check for new products (first seen within date range) and quantity spikes
  for (const li of lineItems) {
    const invoiceDate = li.invoice.invoiceDate
    if (!invoiceDate) continue

    const history = allTimeProducts.get(li.productName)
    if (!history) continue

    // New product: first seen is within our date range
    if (history.firstSeen >= startDate) {
      orderAnomalies.push({
        productName: li.productName,
        type: "new_product",
        details: `First time ordering ${li.productName}`,
        invoiceDate: invoiceDate.toISOString().slice(0, 10),
        vendorName: li.invoice.vendorName,
      })
      continue
    }

    // Quantity spike: >2x rolling average
    if (history.quantities.length >= 3) {
      const avgQty =
        history.quantities.reduce((s, q) => s + q, 0) /
        history.quantities.length
      if (avgQty > 0 && li.quantity > avgQty * 2) {
        orderAnomalies.push({
          productName: li.productName,
          type: "quantity_spike",
          details: `Ordered ${li.quantity} (avg: ${avgQty.toFixed(1)}) - ${(li.quantity / avgQty).toFixed(1)}x typical order`,
          invoiceDate: invoiceDate.toISOString().slice(0, 10),
          vendorName: li.invoice.vendorName,
        })
      }
    }
  }

  // Deduplicate anomalies by product + type
  const uniqueAnomalies = new Map<string, OrderAnomaly>()
  for (const anomaly of orderAnomalies) {
    const key = `${anomaly.productName}:::${anomaly.type}`
    if (!uniqueAnomalies.has(key)) {
      uniqueAnomalies.set(key, anomaly)
    }
  }

  // ── Compute vendor price trends (inline, top 10 by spend) ──
  const vendorPriceTrends = computeVendorPriceTrends(lineItems)

  // ── Build KPIs ──
  const totalPurchasedCost = ingredientUsage.reduce(
    (sum, r) => sum + r.purchasedCost,
    0
  )
  const theoreticalIngredientCost = ingredientUsage.reduce(
    (sum, r) => sum + r.theoreticalUsage * r.avgUnitCost,
    0
  )
  const wasteEstimatedCost = ingredientUsage.reduce(
    (sum, r) => sum + r.wasteEstimatedCost,
    0
  )
  const wastePercent =
    totalPurchasedCost > 0
      ? (wasteEstimatedCost / totalPurchasedCost) * 100
      : 0

  const menuItemsWithRecipe = new Set<string>()
  for (const [menuKey] of menuSalesMap) {
    if (recipeMap.has(menuKey)) menuItemsWithRecipe.add(menuKey)
  }

  const kpis: ProductUsageKpis = {
    totalPurchasedCost,
    theoreticalIngredientCost,
    wasteEstimatedCost,
    wastePercent,
    ingredientsTracked: ingredientUsage.length,
    recipesConfigured: recipes.length,
    menuItemsCovered: menuItemsWithRecipe.size,
  }

  // ── Format recipes for response ──
  const recipesFormatted: RecipeWithIngredients[] = recipes.map((r) => ({
    id: r.id,
    itemName: r.itemName,
    category: r.category,
    servingSize: r.servingSize,
    notes: r.notes,
    isAiGenerated: r.isAiGenerated,
    isConfirmed: r.isConfirmed,
    ingredients: r.ingredients.map((ing) => ({
      id: ing.id,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    })),
  }))

  return {
    kpis,
    ingredientUsage,
    menuItemCosts,
    categoryBreakdown,
    vendorPriceTrends,
    priceAlerts,
    orderAnomalies: Array.from(uniqueAnomalies.values()),
    recipes: recipesFormatted,
    dateRange: {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    },
    hasRecipes: recipes.length > 0,
  }
}

// Helper: compute vendor price trends from line items
function computeVendorPriceTrends(
  lineItems: {
    productName: string
    category: string | null
    unit: string | null
    unitPrice: number
    extendedPrice: number
    invoice: { vendorName: string; invoiceDate: Date | null }
  }[]
): VendorPriceTrend[] {
  // Group by productName → total spend for ranking
  const productSpend = new Map<
    string,
    {
      totalSpend: number
      category: string | null
      unit: string | null
      dataPoints: Map<string, { prices: number[]; vendor: string }>
    }
  >()

  for (const li of lineItems) {
    const invoiceDate = li.invoice.invoiceDate
    if (!invoiceDate) continue

    const dateStr = invoiceDate.toISOString().slice(0, 10)
    const existing = productSpend.get(li.productName)
    if (existing) {
      existing.totalSpend += li.extendedPrice
      const dpKey = `${dateStr}:::${li.invoice.vendorName}`
      const dp = existing.dataPoints.get(dpKey)
      if (dp) {
        dp.prices.push(li.unitPrice)
      } else {
        existing.dataPoints.set(dpKey, {
          prices: [li.unitPrice],
          vendor: li.invoice.vendorName,
        })
      }
    } else {
      const dataPoints = new Map<
        string,
        { prices: number[]; vendor: string }
      >()
      dataPoints.set(`${dateStr}:::${li.invoice.vendorName}`, {
        prices: [li.unitPrice],
        vendor: li.invoice.vendorName,
      })
      productSpend.set(li.productName, {
        totalSpend: li.extendedPrice,
        category: li.category,
        unit: li.unit,
        dataPoints,
      })
    }
  }

  // Take top 10 by total spend
  const top10 = Array.from(productSpend.entries())
    .sort((a, b) => b[1].totalSpend - a[1].totalSpend)
    .slice(0, 10)

  return top10.map(([productName, data]) => {
    const dataPoints = Array.from(data.dataPoints.entries())
      .map(([key, val]) => {
        const [date, vendor] = key.split(":::")
        const avgUnitPrice =
          val.prices.reduce((s, p) => s + p, 0) / val.prices.length
        return { date, avgUnitPrice, vendor }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    // Compute price change: latest vs 30-day trailing avg
    let priceChangePercent: number | null = null
    if (dataPoints.length >= 2) {
      const latestPrice = dataPoints[dataPoints.length - 1].avgUnitPrice
      const trailing = dataPoints.slice(0, -1)
      const trailingAvg =
        trailing.reduce((s, dp) => s + dp.avgUnitPrice, 0) / trailing.length
      if (trailingAvg > 0) {
        priceChangePercent =
          ((latestPrice - trailingAvg) / trailingAvg) * 100
      }
    }

    return {
      productName,
      category: data.category,
      unit: data.unit,
      dataPoints,
      priceChangePercent,
    }
  })
}

// ─── 2. Get recipes ───

export async function getRecipes(
  storeId?: string
): Promise<RecipeWithIngredients[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const targetStoreIds = storeId ? [storeId] : storeIds

  const recipes = await prisma.recipe.findMany({
    where: { storeId: { in: targetStoreIds } },
    include: {
      ingredients: {
        select: {
          id: true,
          ingredientName: true,
          quantity: true,
          unit: true,
          notes: true,
        },
      },
    },
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  })

  return recipes.map((r) => ({
    id: r.id,
    itemName: r.itemName,
    category: r.category,
    servingSize: r.servingSize,
    notes: r.notes,
    isAiGenerated: r.isAiGenerated,
    isConfirmed: r.isConfirmed,
    ingredients: r.ingredients.map((ing) => ({
      id: ing.id,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    })),
  }))
}

// ─── 3. Upsert recipe ───

export async function upsertRecipe(
  storeId: string,
  data: RecipeInput
): Promise<RecipeWithIngredients | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  // Verify ownership
  const store = await prisma.store.findFirst({
    where: { id: storeId, ownerId: session.user.id },
  })
  if (!store) return null

  const result = await prisma.$transaction(async (tx) => {
    // Upsert the recipe
    const recipe = await tx.recipe.upsert({
      where: {
        storeId_itemName_category: {
          storeId,
          itemName: data.itemName,
          category: data.category,
        },
      },
      create: {
        storeId,
        itemName: data.itemName,
        category: data.category,
        servingSize: data.servingSize ?? 1,
        notes: data.notes ?? null,
        isAiGenerated: false,
        isConfirmed: true,
      },
      update: {
        servingSize: data.servingSize ?? 1,
        notes: data.notes ?? null,
        isConfirmed: true,
        updatedAt: new Date(),
      },
    })

    // Delete old ingredients and recreate
    await tx.recipeIngredient.deleteMany({
      where: { recipeId: recipe.id },
    })

    if (data.ingredients.length > 0) {
      await tx.recipeIngredient.createMany({
        data: data.ingredients.map((ing) => ({
          recipeId: recipe.id,
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes ?? null,
        })),
      })
    }

    // Fetch the complete recipe with ingredients
    return tx.recipe.findUnique({
      where: { id: recipe.id },
      include: {
        ingredients: {
          select: {
            id: true,
            ingredientName: true,
            quantity: true,
            unit: true,
            notes: true,
          },
        },
      },
    })
  })

  if (!result) return null

  return {
    id: result.id,
    itemName: result.itemName,
    category: result.category,
    servingSize: result.servingSize,
    notes: result.notes,
    isAiGenerated: result.isAiGenerated,
    isConfirmed: result.isConfirmed,
    ingredients: result.ingredients.map((ing) => ({
      id: ing.id,
      ingredientName: ing.ingredientName,
      quantity: ing.quantity,
      unit: ing.unit,
      notes: ing.notes,
    })),
  }
}

// ─── 4. Delete recipe ───

export async function deleteRecipe(recipeId: string): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return false

  // Verify ownership through store
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { store: { select: { ownerId: true } } },
  })

  if (!recipe || recipe.store.ownerId !== session.user.id) return false

  await prisma.recipe.delete({ where: { id: recipeId } })
  return true
}

// ─── 5. Upsert ingredient alias ───

export async function upsertIngredientAlias(
  storeId: string,
  data: {
    rawName: string
    canonicalName: string
    conversionFactor?: number
    fromUnit: string
    toUnit: string
  }
): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return false

  // Verify ownership
  const store = await prisma.store.findFirst({
    where: { id: storeId, ownerId: session.user.id },
  })
  if (!store) return false

  await prisma.ingredientAlias.upsert({
    where: {
      storeId_rawName: {
        storeId,
        rawName: data.rawName,
      },
    },
    create: {
      storeId,
      rawName: data.rawName,
      canonicalName: data.canonicalName,
      conversionFactor: data.conversionFactor ?? 1,
      fromUnit: data.fromUnit,
      toUnit: data.toUnit,
    },
    update: {
      canonicalName: data.canonicalName,
      conversionFactor: data.conversionFactor ?? 1,
      fromUnit: data.fromUnit,
      toUnit: data.toUnit,
    },
  })

  return true
}

// ─── 6. Get menu items for recipe builder ───

export async function getMenuItemsForRecipeBuilder(
  storeId?: string
): Promise<MenuItemForRecipeBuilder[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const targetStoreIds = storeId ? [storeId] : storeIds

  // Last 30 days
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - 30)

  const [menuItems, recipes] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: targetStoreIds },
        date: { gte: sinceDate },
      },
      select: {
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
      },
    }),
    prisma.recipe.findMany({
      where: { storeId: { in: targetStoreIds } },
      select: { itemName: true, category: true },
    }),
  ])

  // Build recipe set for lookup
  const recipeSet = new Set<string>()
  for (const r of recipes) {
    recipeSet.add(`${r.itemName}:::${r.category}`)
  }

  // Aggregate menu items by (itemName, category)
  const menuMap = new Map<
    string,
    { itemName: string; category: string; totalQtySold: number }
  >()
  for (const mi of menuItems) {
    const key = `${mi.itemName}:::${mi.category}`
    const existing = menuMap.get(key)
    const qtySold = mi.fpQuantitySold + mi.tpQuantitySold
    if (existing) {
      existing.totalQtySold += qtySold
    } else {
      menuMap.set(key, {
        itemName: mi.itemName,
        category: mi.category,
        totalQtySold: qtySold,
      })
    }
  }

  return Array.from(menuMap.values())
    .map((item) => ({
      itemName: item.itemName,
      category: item.category,
      hasRecipe: recipeSet.has(`${item.itemName}:::${item.category}`),
      totalQuantitySold: item.totalQtySold,
    }))
    .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)
}

// ─── 7. Get vendor price trends ───

export async function getVendorPriceTrends(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<VendorPriceTrend[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  const { storeId, days = 90, startDate: startStr, endDate: endStr } = options ?? {}

  let startDate: Date, endDate: Date
  if (startStr && endStr) {
    startDate = new Date(startStr + "T00:00:00")
    endDate = new Date(endStr + "T23:59:59")
  } else {
    endDate = new Date()
    startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhere: any = {
    ownerId: session.user.id,
    invoiceDate: { gte: startDate, lte: endDate },
  }
  if (storeId) invoiceWhere.storeId = storeId

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoice: invoiceWhere },
    select: {
      productName: true,
      category: true,
      unit: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: {
        select: {
          vendorName: true,
          invoiceDate: true,
        },
      },
    },
  })

  return computeVendorPriceTrends(lineItems)
}

// ─── 8. Generate AI Insights + Anomaly Explanations ───

export async function generateAiInsights(context: {
  kpis: ProductUsageKpis
  topVarianceItems: { name: string; variancePct: number; wasteEstimatedCost: number }[]
  priceAlerts: PriceAlert[]
  orderAnomalies: OrderAnomaly[]
  dateRange: { startDate: string; endDate: string }
}): Promise<{
  insights: string[]
  anomalyExplanations: AnomalyExplanation[]
}> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { insights: [], anomalyExplanations: [] }

  const client = getOpenAIClient()

  const prompt = `You are a restaurant operations analyst for a slider restaurant (ChrisNEddys). Analyze the following purchasing and usage data and provide actionable insights.

## Key Metrics (${context.dateRange.startDate} to ${context.dateRange.endDate})
- Total Purchased: $${context.kpis.totalPurchasedCost.toFixed(2)}
- Theoretical Usage: $${context.kpis.theoreticalIngredientCost.toFixed(2)}
- Estimated Waste: $${context.kpis.wasteEstimatedCost.toFixed(2)} (${context.kpis.wastePercent.toFixed(1)}%)
- Recipes Configured: ${context.kpis.recipesConfigured}
- Menu Items Covered: ${context.kpis.menuItemsCovered}

## Top Variance Items (over-ordered)
${context.topVarianceItems.map(i => `- ${i.name}: ${i.variancePct > 0 ? "+" : ""}${i.variancePct.toFixed(1)}% variance, ~$${i.wasteEstimatedCost.toFixed(2)} waste`).join("\n")}

## Price Alerts
${context.priceAlerts.length > 0 ? context.priceAlerts.map(a => `- ${a.message}`).join("\n") : "No significant price changes."}

## Order Anomalies
${context.orderAnomalies.length > 0 ? context.orderAnomalies.map(a => `- [${a.type}] ${a.productName}: ${a.details} (${a.vendorName}, ${a.invoiceDate})`).join("\n") : "No unusual orders detected."}

Return JSON with this exact structure:
{
  "insights": ["insight1", "insight2", ...],
  "anomalyExplanations": [
    {
      "alertId": "product_name:::alert_type",
      "explanation": "Why this happened",
      "suggestedAction": "What to do about it",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Guidelines:
- Provide 3-5 specific, actionable insights about cost savings, ordering optimization, or waste reduction
- Reference specific dollar amounts and percentages
- For anomaly explanations, provide one per price alert and order anomaly
- Be practical — this is a small slider restaurant, not a Fortune 500 company
- alertId format: "productName:::increase" for price alerts, "productName:::new_product" or "productName:::quantity_spike" for anomalies`

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return { insights: [], anomalyExplanations: [] }

    const parsed = JSON.parse(content)
    return {
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      anomalyExplanations: Array.isArray(parsed.anomalyExplanations)
        ? parsed.anomalyExplanations
        : [],
    }
  } catch (err) {
    console.error("AI insights generation failed:", err)
    return { insights: [], anomalyExplanations: [] }
  }
}

// ─── 9. Generate Demand Forecast ───

export async function generateDemandForecast(
  storeId?: string
): Promise<DemandForecast[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return []

  const targetStoreIds = storeId ? [storeId] : storeIds

  // Get last 4 weeks of daily sales data
  const fourWeeksAgo = new Date()
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)

  const [menuItems, recipes, aliases, recentInvoiceItems] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: targetStoreIds },
        date: { gte: fourWeeksAgo },
      },
      select: {
        itemName: true,
        category: true,
        date: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.recipe.findMany({
      where: { storeId: { in: targetStoreIds } },
      include: { ingredients: true },
    }),
    prisma.ingredientAlias.findMany({
      where: { storeId: { in: targetStoreIds } },
    }),
    // Recent invoice items to estimate current stock (last 7 days)
    prisma.invoiceLineItem.findMany({
      where: {
        invoice: {
          ownerId: session.user.id,
          ...(storeId ? { storeId } : {}),
          invoiceDate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      },
      select: {
        productName: true,
        quantity: true,
        unit: true,
      },
    }),
  ])

  if (menuItems.length === 0 || recipes.length === 0) return []

  // Build alias lookup
  const aliasMap = new Map<string, { canonicalName: string; conversionFactor: number; toUnit: string }>()
  for (const alias of aliases) {
    aliasMap.set(alias.rawName.toLowerCase(), {
      canonicalName: alias.canonicalName,
      conversionFactor: alias.conversionFactor,
      toUnit: alias.toUnit,
    })
  }

  // Aggregate daily sales by menu item
  const dailySales: Record<string, { date: string; totalSold: number }[]> = {}
  for (const mi of menuItems) {
    const key = `${mi.itemName}:::${mi.category}`
    const dateStr = mi.date.toISOString().slice(0, 10)
    const qtySold = mi.fpQuantitySold + mi.tpQuantitySold
    if (!dailySales[key]) dailySales[key] = []
    dailySales[key].push({ date: dateStr, totalSold: qtySold })
  }

  // Build recipe map
  const recipeMap = new Map<string, (typeof recipes)[number]>()
  for (const recipe of recipes) {
    recipeMap.set(`${recipe.itemName}:::${recipe.category}`, recipe)
  }

  // Estimate current stock from recent invoices
  const stockEstimate = new Map<string, { qty: number; unit: string }>()
  for (const li of recentInvoiceItems) {
    const rawName = li.productName.toLowerCase()
    const alias = aliasMap.get(rawName)
    const canonicalName = alias ? alias.canonicalName : li.productName
    const convertedQty = alias ? li.quantity * alias.conversionFactor : li.quantity
    const unit = alias ? alias.toUnit : li.unit ?? "unit"

    const existing = stockEstimate.get(canonicalName)
    if (existing) {
      existing.qty += convertedQty
    } else {
      stockEstimate.set(canonicalName, { qty: convertedQty, unit })
    }
  }

  // Prepare data for AI
  const salesSummary = Object.entries(dailySales)
    .filter(([key]) => recipeMap.has(key))
    .map(([key, data]) => {
      const [itemName, category] = key.split(":::")
      const recipe = recipeMap.get(key)!
      return {
        itemName,
        category,
        dailySales: data,
        ingredients: recipe.ingredients.map((i) => ({
          name: i.ingredientName,
          qtyPerServing: i.quantity,
          unit: i.unit,
        })),
      }
    })
    .slice(0, 15) // Limit to top 15 items for token efficiency

  if (salesSummary.length === 0) return []

  // Collect unique ingredients from recipes
  const ingredientUnits = new Map<string, string>()
  for (const item of salesSummary) {
    for (const ing of item.ingredients) {
      if (!ingredientUnits.has(ing.name)) {
        ingredientUnits.set(ing.name, ing.unit)
      }
    }
  }

  const stockInfo = Array.from(ingredientUnits.entries()).map(([name, unit]) => {
    const stock = stockEstimate.get(name)
    return {
      ingredientName: name,
      unit,
      estimatedStock: stock?.qty ?? 0,
    }
  })

  const client = getOpenAIClient()

  const prompt = `You are a restaurant demand forecasting analyst for ChrisNEddys (a slider restaurant). Based on the past 4 weeks of daily sales data and recipe configurations, predict next week's ingredient needs.

## Menu Items with Daily Sales (last 4 weeks)
${JSON.stringify(salesSummary, null, 2)}

## Current Estimated Stock (from last 7 days of invoices)
${JSON.stringify(stockInfo, null, 2)}

For EACH unique ingredient across all recipes, predict next week's usage and suggest order quantities. Return JSON:
{
  "forecasts": [
    {
      "ingredientName": "exact ingredient name from recipes",
      "predictedUsageNextWeek": number,
      "unit": "unit string",
      "suggestedOrderQty": number,
      "currentEstimatedStock": number,
      "confidence": "high" | "medium" | "low",
      "reasoning": "Brief explanation of the prediction",
      "needsReorder": boolean
    }
  ]
}

Guidelines:
- Account for day-of-week patterns (weekends are typically busier)
- Account for trends (increasing/decreasing sales)
- suggestedOrderQty should cover predicted usage minus existing stock, with a 10% safety margin
- Set needsReorder=true when predicted usage exceeds estimated stock
- confidence: "high" if consistent daily pattern, "medium" if some variance, "low" if erratic`

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 3000,
    })

    const content = response.choices[0]?.message?.content
    if (!content) return []

    const parsed = JSON.parse(content)
    return Array.isArray(parsed.forecasts) ? parsed.forecasts : []
  } catch (err) {
    console.error("Demand forecast generation failed:", err)
    return []
  }
}
