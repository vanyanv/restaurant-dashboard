"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { parseDateRange } from "@/app/actions/_shared/date-range"
import { resolveStoreScope } from "@/app/actions/_shared/auth-scope"
import { computeVariance } from "@/app/actions/_shared/variance"
import type {
  ProductUsageData,
  RecipeWithIngredients,
  IngredientUsageRow,
  MenuItemCostRow,
  CategorySummaryRow,
  VendorPriceTrend,
  PriceAlert,
  OrderAnomaly,
  ProductUsageKpis,
} from "@/types/product-usage"

export async function getProductUsageData(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<ProductUsageData | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null

  const { storeId } = options ?? {}
  const { startDate, endDate } = parseDateRange(options, 30)

  const scope = await resolveStoreScope(session, storeId)
  if (!scope) return null
  const { storeIds, targetStoreIds } = scope
  if (storeIds.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhere: any = {
    accountId: session.user.accountId,
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
      // All recipes with ingredients for the owner
      prisma.recipe.findMany({
        where: { accountId: session.user.accountId },
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
          invoice: { accountId: session.user.accountId },
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
  // lowercased canonicalName → { purchasedQty (in recipe units), totalCost, unitCosts, invoiceIds, category, unit }
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
  // Track best display name per lowercased key
  const displayNameMap = new Map<string, string>()

  for (const li of lineItems) {
    const rawName = li.productName.toLowerCase()
    const alias = aliasMap.get(rawName)
    const canonicalName = alias ? alias.canonicalName : li.productName
    const key = canonicalName.toLowerCase()
    const convertedQty = alias
      ? li.quantity * alias.conversionFactor
      : li.quantity
    const unit = alias ? alias.toUnit : li.unit ?? "unit"

    if (!displayNameMap.has(key)) displayNameMap.set(key, canonicalName)

    const existing = purchasedMap.get(key)
    if (existing) {
      existing.purchasedQty += convertedQty
      existing.totalCost += li.extendedPrice
      existing.invoiceIds.add(li.invoiceId)
    } else {
      purchasedMap.set(key, {
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
  const recipeMap = new Map<string, (typeof recipes)[number]>()
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
      const theoreticalQty = sales.totalQtySold * (ing.quantity / recipe.servingSize)
      const ingName = ing.ingredientName ?? ""
      const ingKey = ingName.toLowerCase()
      if (!displayNameMap.has(ingKey)) displayNameMap.set(ingKey, ingName)
      theoreticalMap.set(
        ingKey,
        (theoreticalMap.get(ingKey) ?? 0) + theoreticalQty
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

    const variance = computeVariance({ purchasedQty, theoretical, avgUnitCost })

    ingredientUsage.push({
      ingredientName: displayNameMap.get(name) ?? name,
      canonicalName: displayNameMap.get(name) ?? name,
      category,
      purchasedQuantity: purchasedQty,
      purchasedUnit: unit,
      purchasedCost,
      avgUnitCost,
      invoiceCount,
      theoreticalUsage: theoretical,
      varianceQuantity: variance.varianceQuantity,
      variancePct: variance.variancePct,
      wasteEstimatedCost: variance.wasteEstimatedCost,
      shortageEstimatedCost: variance.shortageEstimatedCost,
      status: variance.status,
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
      // Check if any ingredient has invoice cost data
      let hasInvoiceCost = false
      for (const ing of recipe.ingredients) {
        const purchased = purchasedMap.get((ing.ingredientName ?? "").toLowerCase())
        if (purchased && purchased.totalCost > 0) {
          hasInvoiceCost = true
          break
        }
      }

      if (!hasInvoiceCost && recipe.foodCostOverride != null) {
        // Use R365 pre-calculated cost when no invoice data matches
        theoreticalCOGS = sales.totalQtySold * recipe.foodCostOverride
      } else {
        for (const ing of recipe.ingredients) {
          const purchased = purchasedMap.get((ing.ingredientName ?? "").toLowerCase())
          const avgCost = purchased
            ? purchased.totalCost / purchased.purchasedQty
            : 0
          theoreticalCOGS += sales.totalQtySold * (ing.quantity / recipe.servingSize) * avgCost
        }
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
    const changePercent = ((latestPrice - trailingAvg) / trailingAvg) * 100

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
    foodCostOverride: r.foodCostOverride,
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

// Private: compute vendor price trends from line items (top 10 by spend)
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
