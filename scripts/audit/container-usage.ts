// scripts/audit/container-usage.ts
//
// Read-only audit for packaging/container usage. It reports current container
// canonicals, order fulfillment mix, item mix by fulfillment mode, and review
// candidates for future fulfillment-aware packaging COGS.
//
// Usage:
//   ./node_modules/.bin/tsx scripts/audit/container-usage.ts
//   ./node_modules/.bin/tsx scripts/audit/container-usage.ts --json
//   ./node_modules/.bin/tsx scripts/audit/container-usage.ts --as-of 2026-05-02

import { loadEnvLocal, money, pct } from "./lib"
import {
  CONTAINER_CANDIDATE_NAMES,
  CONTAINER_GROUP_CANONICALS,
  CONTAINER_GROUP_LABELS,
  PACKING_SCENARIOS,
  addContainerCounts,
  classifyBasket,
  containerGroupForCanonical,
  costForCounts,
  emptyContainerCounts,
  formatContainerCounts,
  formatQty,
  invoiceEachUnits,
  normalizeFulfillmentMode,
  packBasket,
  type ContainerCounts,
  type ContainerGroup,
  type FulfillmentBucket,
  type PackingUnits,
  type PackingScenario,
} from "../../src/lib/container-packaging"

loadEnvLocal()

type CountMoney = {
  orders: number
  subtotal: number
  total: number
}

type ItemMix = {
  itemName: string
  category: string
  candidateGroup: CandidateGroup
  deliveryQty: number
  pickupQty: number
  dineInQty: number
  otherQty: number
  unknownQty: number
  totalQty: number
  takeawayQty: number
  revenue: number
}

type BasketSignatureSummary = {
  signature: string
  rawSignature: string
  orders: number
  fulfillment: Record<FulfillmentBucket, number>
  units: PackingUnits
  examples: Array<{ orderId: string; displayId: string | null; fulfillment: FulfillmentBucket; date: string }>
}

type CandidateGroup =
  | "combos/fries candidates"
  | "slider-only candidates"
  | "sides/secret menu candidates"
  | "other/review"

const WINDOW_DAYS = [30, 60, 90]

function arg(name: string): boolean {
  return process.argv.includes(name)
}

function valueArg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function parseAsOf(): Date {
  const raw = valueArg("--as-of")
  if (!raw) return new Date()
  const d = new Date(`${raw}T23:59:59.999Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid --as-of date: ${raw}`)
  return d
}

function startMinusDays(asOf: Date, days: number): Date {
  const d = new Date(asOf)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

function dateKey(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "-"
}

function fulfillmentLabel(bucket: FulfillmentBucket): string {
  return bucket === "DINE_IN" ? "dine-in" : bucket.toLowerCase()
}

function printSection(title: string): void {
  console.log("")
  console.log(title)
  console.log("-".repeat(title.length))
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

function inferCandidateGroup(itemName: string, category: string): CandidateGroup {
  const name = itemName.toLowerCase()
  const cat = category.toLowerCase()
  if (cat.includes("combo") || name.includes("combo") || name.includes("fries")) {
    return "combos/fries candidates"
  }
  if (name.includes("slider")) return "slider-only candidates"
  if (
    cat.includes("side") ||
    cat.includes("secret") ||
    name.includes("tender") ||
    name.includes("loaded")
  ) {
    return "sides/secret menu candidates"
  }
  return "other/review"
}

function addCountMoney(target: CountMoney, subtotal: number, total: number): void {
  target.orders += 1
  target.subtotal += subtotal
  target.total += total
}

function emptyCountMoney(): CountMoney {
  return { orders: 0, subtotal: 0, total: 0 }
}

async function main(): Promise<void> {
  const json = arg("--json")
  const asOf = parseAsOf()
  const earliest = startMinusDays(asOf, Math.max(...WINDOW_DAYS))
  const { prisma } = await import("../../src/lib/prisma")
  const { computeRecipeCost } = await import("../../src/lib/recipe-cost")

  const [containerCanonicals, recentCategories, orders, containerInvoiceLines, combo3] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: {
        OR: [
          { name: { contains: "container", mode: "insensitive" } },
          { name: { in: CONTAINER_CANDIDATE_NAMES } },
        ],
      },
      select: {
        id: true,
        name: true,
        category: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
        costLocked: true,
        costUpdatedAt: true,
        skuMatches: {
          select: {
            vendorName: true,
            sku: true,
            conversionFactor: true,
            fromUnit: true,
            toUnit: true,
          },
          orderBy: { confirmedAt: "desc" },
          take: 5,
        },
        invoiceLineItems: {
          select: {
            sku: true,
            productName: true,
            quantity: true,
            unit: true,
            unitPrice: true,
            extendedPrice: true,
            invoice: {
              select: {
                vendorName: true,
                invoiceDate: true,
                isReturn: true,
              },
            },
          },
          orderBy: { invoice: { invoiceDate: "desc" } },
          take: 5,
        },
        _count: {
          select: {
            invoiceLineItems: true,
            recipeIngredients: true,
            skuMatches: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.otterMenuItem.findMany({
      where: {
        isModifier: false,
        date: { gte: earliest, lte: asOf },
      },
      select: {
        itemName: true,
        category: true,
        date: true,
      },
      orderBy: [{ date: "desc" }],
    }),
    prisma.otterOrder.findMany({
      where: {
        referenceTimeLocal: { gte: earliest, lte: asOf },
      },
      select: {
        id: true,
        otterOrderId: true,
        externalDisplayId: true,
        fulfillmentMode: true,
        referenceTimeLocal: true,
        subtotal: true,
        total: true,
        items: {
          select: {
            name: true,
            quantity: true,
            price: true,
            subItems: {
              select: {
                name: true,
                quantity: true,
                subHeader: true,
              },
            },
          },
        },
      },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        invoice: { invoiceDate: { gte: earliest, lte: asOf } },
        canonicalIngredient: {
          name: { in: CONTAINER_CANDIDATE_NAMES },
        },
      },
      select: {
        sku: true,
        productName: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        canonicalIngredient: {
          select: {
            name: true,
            costPerRecipeUnit: true,
          },
        },
        invoice: {
          select: {
            vendorName: true,
            invoiceDate: true,
            isReturn: true,
          },
        },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
    }),
    prisma.recipe.findFirst({
      where: { itemName: "Combo 3" },
      select: {
        id: true,
        itemName: true,
        category: true,
        notes: true,
        ingredients: {
          select: {
            quantity: true,
            unit: true,
            ingredientName: true,
            canonicalIngredient: { select: { name: true } },
            componentRecipe: { select: { itemName: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ])

  const categoryByItem = new Map<string, string>()
  for (const row of recentCategories) {
    const key = normalizeKey(row.itemName)
    if (!categoryByItem.has(key)) categoryByItem.set(key, row.category)
  }

  const orderCountsByWindow: Record<number, Record<FulfillmentBucket, CountMoney>> = {}
  for (const days of WINDOW_DAYS) {
    const start = startMinusDays(asOf, days)
    orderCountsByWindow[days] = {
      DELIVERY: emptyCountMoney(),
      PICKUP: emptyCountMoney(),
      DINE_IN: emptyCountMoney(),
      UNKNOWN: emptyCountMoney(),
      OTHER: emptyCountMoney(),
    }
    for (const order of orders) {
      if (order.referenceTimeLocal < start) continue
      const bucket = normalizeFulfillmentMode(order.fulfillmentMode)
      addCountMoney(orderCountsByWindow[days][bucket], order.subtotal ?? 0, order.total ?? 0)
    }
  }

  const itemMixByKey = new Map<string, ItemMix>()
  const rawFulfillmentModes = new Map<string, number>()
  for (const order of orders) {
    const rawMode = order.fulfillmentMode ?? "(null)"
    rawFulfillmentModes.set(rawMode, (rawFulfillmentModes.get(rawMode) ?? 0) + 1)
    const bucket = normalizeFulfillmentMode(order.fulfillmentMode)

    for (const item of order.items) {
      const itemName = item.name
      const category = categoryByItem.get(normalizeKey(itemName)) ?? "(unknown)"
      const key = `${normalizeKey(itemName)}::${normalizeKey(category)}`
      let row = itemMixByKey.get(key)
      if (!row) {
        row = {
          itemName,
          category,
          candidateGroup: inferCandidateGroup(itemName, category),
          deliveryQty: 0,
          pickupQty: 0,
          dineInQty: 0,
          otherQty: 0,
          unknownQty: 0,
          totalQty: 0,
          takeawayQty: 0,
          revenue: 0,
        }
        itemMixByKey.set(key, row)
      }

      const quantity = item.quantity ?? 0
      const revenue = item.price ?? 0
      row.totalQty += quantity
      row.revenue += revenue
      if (bucket === "DELIVERY") {
        row.deliveryQty += quantity
        row.takeawayQty += quantity
      } else if (bucket === "PICKUP") {
        row.pickupQty += quantity
        row.takeawayQty += quantity
      } else if (bucket === "DINE_IN") {
        row.dineInQty += quantity
      } else if (bucket === "UNKNOWN") {
        row.unknownQty += quantity
      } else {
        row.otherQty += quantity
      }
    }
  }

  const itemMix = [...itemMixByKey.values()].sort((a, b) => b.takeawayQty - a.takeawayQty)
  const candidateGroups = new Map<CandidateGroup, ItemMix[]>()
  for (const item of itemMix) {
    const rows = candidateGroups.get(item.candidateGroup) ?? []
    rows.push(item)
    candidateGroups.set(item.candidateGroup, rows)
  }

  const containerCosts = new Map(
    containerCanonicals.map((c) => [c.name, c.costPerRecipeUnit ?? null])
  )
  const groupSummary = [...candidateGroups.entries()].map(([group, rows]) => {
    const takeawayQty = rows.reduce((sum, row) => sum + row.takeawayQty, 0)
    const dineInQty = rows.reduce((sum, row) => sum + row.dineInQty, 0)
    const unknownQty = rows.reduce((sum, row) => sum + row.unknownQty, 0)
    return {
      group,
      itemCount: rows.length,
      takeawayQty,
      dineInQty,
      unknownQty,
      topItems: rows.slice(0, 10),
      projectedContainerCostByCandidate: CONTAINER_CANDIDATE_NAMES.map((name) => {
        const unitCost = containerCosts.get(name)
        return {
          container: name,
          unitCost,
          projectedTakeawayCost: unitCost == null ? null : unitCost * takeawayQty,
          projectedDineInExclusion: unitCost == null ? null : unitCost * dineInQty,
        }
      }),
    }
  })

  const fallbackGroupCosts = Object.fromEntries(
    (Object.keys(CONTAINER_GROUP_CANONICALS) as ContainerGroup[]).map((group) => {
      const costs = CONTAINER_GROUP_CANONICALS[group]
        .map((name) => containerCosts.get(name))
        .filter((cost): cost is number => cost != null)
      return [group, costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : null]
    })
  ) as Record<ContainerGroup, number | null>

  const invoicePurchasesByWindow = WINDOW_DAYS.map((days) => {
    const start = startMinusDays(asOf, days)
    const groups = Object.fromEntries(
      (Object.keys(CONTAINER_GROUP_CANONICALS) as ContainerGroup[]).map((group) => [
        group,
        {
          label: CONTAINER_GROUP_LABELS[group],
          purchasedUnits: 0,
          spend: 0,
          weightedUnitCost: null as number | null,
          invoiceLineCount: 0,
          canonicalNames: CONTAINER_GROUP_CANONICALS[group],
        },
      ])
    ) as Record<
      ContainerGroup,
      {
        label: string
        purchasedUnits: number
        spend: number
        weightedUnitCost: number | null
        invoiceLineCount: number
        canonicalNames: string[]
      }
    >

    for (const line of containerInvoiceLines) {
      const invoiceDate = line.invoice.invoiceDate
      if (!invoiceDate || invoiceDate < start) continue
      const canonicalName = line.canonicalIngredient?.name
      if (!canonicalName) continue
      const group = containerGroupForCanonical(canonicalName)
      if (!group) continue
      const purchasedUnits = invoiceEachUnits(line)
      groups[group].purchasedUnits += purchasedUnits
      groups[group].spend += line.extendedPrice
      groups[group].invoiceLineCount += 1
    }

    for (const group of Object.keys(groups) as ContainerGroup[]) {
      const row = groups[group]
      row.weightedUnitCost = row.purchasedUnits !== 0 ? row.spend / row.purchasedUnits : fallbackGroupCosts[group]
    }

    return { days, groups }
  })

  const groupCosts90 =
    invoicePurchasesByWindow.find((row) => row.days === 90)?.groups ?? invoicePurchasesByWindow.at(-1)?.groups
  const packingGroupCosts = Object.fromEntries(
    (Object.keys(CONTAINER_GROUP_CANONICALS) as ContainerGroup[]).map((group) => [
      group,
      groupCosts90?.[group]?.weightedUnitCost ?? fallbackGroupCosts[group],
    ])
  ) as Record<ContainerGroup, number | null>

  const classifiedOrders = orders.map((order) => {
    const classification = classifyBasket(order)
    const scenarioCounts = Object.fromEntries(
      PACKING_SCENARIOS.map((scenario) => [scenario, packBasket(classification.units, scenario)])
    ) as Record<PackingScenario, ContainerCounts>
    return {
      order,
      bucket: normalizeFulfillmentMode(order.fulfillmentMode),
      classification,
      scenarioCounts,
    }
  })

  const basketSignatures = new Map<string, BasketSignatureSummary>()
  const unclassifiedItemSummary = new Map<
    string,
    { name: string; reason: string; takeawayQty: number; dineInQty: number; orderCount: number }
  >()
  const ambiguousBasketSummary = new Map<
    string,
    {
      signature: string
      rawSignature: string
      orders: number
      takeawayOrders: number
      unclassifiedItems: Array<{ name: string; quantity: number; reason: string }>
      examples: Array<{ orderId: string; displayId: string | null; fulfillment: FulfillmentBucket; date: string }>
    }
  >()

  for (const row of classifiedOrders) {
    const key = row.classification.normalizedSignature
    let signature = basketSignatures.get(key)
    if (!signature) {
      signature = {
        signature: row.classification.normalizedSignature,
        rawSignature: row.classification.rawSignature,
        orders: 0,
        fulfillment: {
          DELIVERY: 0,
          PICKUP: 0,
          DINE_IN: 0,
          UNKNOWN: 0,
          OTHER: 0,
        },
        units: row.classification.units,
        examples: [],
      }
      basketSignatures.set(key, signature)
    }
    signature.orders += 1
    signature.fulfillment[row.bucket] += 1
    if (signature.examples.length < 4) {
      signature.examples.push({
        orderId: row.order.otterOrderId,
        displayId: row.order.externalDisplayId,
        fulfillment: row.bucket,
        date: dateKey(row.order.referenceTimeLocal),
      })
    }

    for (const item of row.classification.unclassifiedItems) {
      const summaryKey = `${normalizeKey(item.name)}::${item.reason}`
      const summary =
        unclassifiedItemSummary.get(summaryKey) ??
        { name: item.name, reason: item.reason, takeawayQty: 0, dineInQty: 0, orderCount: 0 }
      if (row.bucket === "DELIVERY" || row.bucket === "PICKUP") summary.takeawayQty += item.quantity
      if (row.bucket === "DINE_IN") summary.dineInQty += item.quantity
      summary.orderCount += 1
      unclassifiedItemSummary.set(summaryKey, summary)
    }

    if (row.classification.unclassifiedItems.length > 0) {
      const existing = ambiguousBasketSummary.get(key) ?? {
        signature: row.classification.normalizedSignature,
        rawSignature: row.classification.rawSignature,
        orders: 0,
        takeawayOrders: 0,
        unclassifiedItems: row.classification.unclassifiedItems,
        examples: [],
      }
      existing.orders += 1
      if (row.bucket === "DELIVERY" || row.bucket === "PICKUP") existing.takeawayOrders += 1
      if (existing.examples.length < 4) {
        existing.examples.push({
          orderId: row.order.otterOrderId,
          displayId: row.order.externalDisplayId,
          fulfillment: row.bucket,
          date: dateKey(row.order.referenceTimeLocal),
        })
      }
      ambiguousBasketSummary.set(key, existing)
    }
  }

  const scenarioDemandByWindow = WINDOW_DAYS.map((days) => {
    const start = startMinusDays(asOf, days)
    const scenarios = PACKING_SCENARIOS.map((scenario) => {
      const fulfillment = {
        DELIVERY: emptyContainerCounts(),
        PICKUP: emptyContainerCounts(),
        total: emptyContainerCounts(),
      }
      const dineInExcluded = emptyContainerCounts()
      const otherExcluded = emptyContainerCounts()
      let unclassifiedTakeawayOrders = 0
      let unclassifiedTakeawayItemQty = 0

      for (const row of classifiedOrders) {
        if (row.order.referenceTimeLocal < start) continue
        const counts = row.scenarioCounts[scenario]
        if (row.bucket === "DELIVERY" || row.bucket === "PICKUP") {
          addContainerCounts(fulfillment[row.bucket], counts)
          addContainerCounts(fulfillment.total, counts)
          if (row.classification.unclassifiedItems.length > 0) {
            unclassifiedTakeawayOrders += 1
            unclassifiedTakeawayItemQty += row.classification.unclassifiedItems.reduce(
              (sum, item) => sum + item.quantity,
              0
            )
          }
        } else if (row.bucket === "DINE_IN") {
          addContainerCounts(dineInExcluded, counts)
        } else {
          addContainerCounts(otherExcluded, counts)
        }
      }

      return {
        scenario,
        fulfillment,
        dineInExcluded,
        dineInAvoidedCost: costForCounts(dineInExcluded, packingGroupCosts),
        otherExcluded,
        unclassifiedTakeawayOrders,
        unclassifiedTakeawayItemQty,
        projectedCost: costForCounts(fulfillment.total, packingGroupCosts),
      }
    })
    return { days, scenarios }
  })

  const scenarioFitByWindow = scenarioDemandByWindow.map((windowDemand) => {
    const purchases = invoicePurchasesByWindow.find((row) => row.days === windowDemand.days)
    return {
      days: windowDemand.days,
      scenarios: windowDemand.scenarios.map((scenarioDemand) => {
        const groups = Object.fromEntries(
          (Object.keys(CONTAINER_GROUP_CANONICALS) as ContainerGroup[]).map((group) => {
            const predictedUnits = scenarioDemand.fulfillment.total[group]
            const purchasedUnits = purchases?.groups[group]?.purchasedUnits ?? 0
            const unitCost = purchases?.groups[group]?.weightedUnitCost ?? packingGroupCosts[group]
            const gapUnits = purchasedUnits - predictedUnits
            return [
              group,
              {
                label: CONTAINER_GROUP_LABELS[group],
                predictedUnits,
                purchasedUnits,
                gapUnits,
                dollarGap: unitCost == null ? null : gapUnits * unitCost,
                utilizationPct: purchasedUnits > 0 ? predictedUnits / purchasedUnits : null,
                unitCost,
              },
            ]
          })
        ) as Record<
          ContainerGroup,
          {
            label: string
            predictedUnits: number
            purchasedUnits: number
            gapUnits: number
            dollarGap: number | null
            utilizationPct: number | null
            unitCost: number | null
          }
        >

        const totalAbsDollarGap = Object.values(groups).reduce(
          (sum, row) => sum + Math.abs(row.dollarGap ?? 0),
          0
        )

        return {
          scenario: scenarioDemand.scenario,
          totalAbsDollarGap,
          groups,
        }
      }),
    }
  })

  const topBasketSignatures = [...basketSignatures.values()]
    .map((row) => ({
      ...row,
      takeawayOrders: row.fulfillment.DELIVERY + row.fulfillment.PICKUP,
    }))
    .filter((row) => row.units.burgers + row.units.fries + row.units.loadedFries + row.units.grilledCheese > 0)
    .sort((a, b) => b.takeawayOrders - a.takeawayOrders)
    .slice(0, 25)

  const unclassifiedItems = [...unclassifiedItemSummary.values()]
    .sort((a, b) => b.takeawayQty - a.takeawayQty)
    .slice(0, 30)

  const ambiguousBaskets = [...ambiguousBasketSummary.values()]
    .sort((a, b) => b.takeawayOrders - a.takeawayOrders)
    .slice(0, 20)

  const combo3Cost = combo3 ? await computeRecipeCost(combo3.id).catch(() => null) : null
  const combo3Lines = combo3?.ingredients.map((line) => ({
    name:
      line.componentRecipe?.itemName ??
      line.canonicalIngredient?.name ??
      line.ingredientName ??
      "(unknown)",
    quantity: line.quantity,
    unit: line.unit,
  })) ?? []
  const combo3Check = {
    recipeFound: combo3 != null,
    notes: combo3?.notes ?? null,
    totalCost: combo3Cost?.totalCost ?? null,
    partial: combo3Cost?.partial ?? null,
    lines: combo3Lines,
    checks: {
      hasTwoTripleSliders: combo3Lines.some(
        (line) => line.name === "Triple Slider" && line.quantity === 2
      ),
      hasStraightCutFries: combo3Lines.some(
        (line) => line.name === "Straight Cut Fries" && line.quantity === 1
      ),
      hasIncludedSauceCup: combo3Lines.some(
        (line) => line.name.toLowerCase().includes("sauce") && line.quantity === 1
      ),
      hasTakeoutBag: combo3Lines.some(
        (line) => line.name.toLowerCase().includes("bag") && line.quantity === 1
      ),
      hasThreeNapkins: combo3Lines.some(
        (line) => line.name.toLowerCase().includes("napkin") && line.quantity === 3
      ),
    },
  }

  const report = {
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString(),
    lookbackDays: WINDOW_DAYS,
    readOnly: true,
    containerCandidateNames: CONTAINER_CANDIDATE_NAMES,
    combo3: combo3Check,
    containerCanonicals: containerCanonicals.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      recipeUnit: c.recipeUnit,
      costPerRecipeUnit: c.costPerRecipeUnit,
      costSource: c.costSource,
      costLocked: c.costLocked,
      costUpdatedAt: c.costUpdatedAt,
      invoiceLineCount: c._count.invoiceLineItems,
      recipeUsageCount: c._count.recipeIngredients,
      skuMatchCount: c._count.skuMatches,
      skuMatches: c.skuMatches,
      latestInvoiceLines: c.invoiceLineItems.map((line) => ({
        vendorName: line.invoice.vendorName,
        invoiceDate: line.invoice.invoiceDate,
        isReturn: line.invoice.isReturn,
        sku: line.sku,
        productName: line.productName,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        extendedPrice: line.extendedPrice,
      })),
    })),
    fulfillment: {
      rawModes: [...rawFulfillmentModes.entries()]
        .map(([mode, orders]) => ({ mode, orders }))
        .sort((a, b) => b.orders - a.orders),
      orderCountsByWindow,
    },
    itemMix90Days: itemMix,
    recommendedMappingCandidates: {
      note:
        "Review-only. These are demand buckets for choosing container rules; no DB changes were made.",
      groups: groupSummary,
      dineInExclusionImpact: groupSummary.map((group) => ({
        group: group.group,
        dineInQty: group.dineInQty,
        projectedAvoidedCostByCandidate: group.projectedContainerCostByCandidate.map((c) => ({
          container: c.container,
          unitCost: c.unitCost,
          avoidedCost: c.projectedDineInExclusion,
        })),
      })),
    },
    basketPacking: {
      note:
        "Read-only basket-level inference. Delivery and pickup are counted as container demand; dine-in is excluded per current assumption.",
      capacities: {
        medium_6x6: "Combo 1, 2 burgers, or 2 loaded fries",
        large_9x6: "2 burgers + fries, 3 burgers, or 4 burgers",
        one_compartment: "1 fries, 1 burger, or 2 grilled cheese",
      },
      scenarioDefinitions: {
        "smallest-fit": "Uses the smallest stated container that can satisfy the basket units.",
        "medium-preferred": "Uses medium 6x6 for single-burger and single-loaded-fries borderline cases.",
        "large-conservative": "Promotes burger-plus-fries baskets to 9x6 when crews may choose the larger box.",
      },
      containerGroupCosts: packingGroupCosts,
      topBasketSignatures,
      predictedContainerUnitsByWindow: scenarioDemandByWindow,
      invoicePurchasedUnitsByWindow: invoicePurchasesByWindow,
      scenarioFitByWindow,
      unclassifiedItems,
      ambiguousBaskets,
    },
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`Container usage audit - ${new Date().toISOString()}`)
  console.log(`As of: ${dateKey(asOf)}; lookback: ${Math.max(...WINDOW_DAYS)} days`)
  console.log("This script is read-only. It does not write recipe, COGS, or mapping rows.")

  printSection("Combo 3 Composition")
  console.log(`Found: ${combo3Check.recipeFound ? "yes" : "no"}`)
  if (combo3Check.recipeFound) {
    console.log(`Total cost: ${money(combo3Check.totalCost)}${combo3Check.partial ? " (partial)" : ""}`)
    for (const line of combo3Lines) {
      console.log(`- ${line.quantity} ${line.unit} ${line.name}`)
    }
    console.log("Checks:")
    for (const [name, passed] of Object.entries(combo3Check.checks)) {
      console.log(`- ${passed ? "PASS" : "FAIL"} ${name}`)
    }
  }

  printSection("Container Canonicals")
  for (const c of report.containerCanonicals) {
    const latest = c.latestInvoiceLines[0]
    const latestSku = latest?.sku ? ` sku=${latest.sku}` : ""
    const latestInfo = latest
      ? ` latest=${latest.vendorName} ${dateKey(latest.invoiceDate)}${latestSku}`
      : " latest=-"
    console.log(
      `- ${c.name}: ${money(c.costPerRecipeUnit)}/${c.recipeUnit ?? "-"}, ` +
        `invoices ${c.invoiceLineCount}, sku matches ${c.skuMatchCount}, ` +
        `recipe uses ${c.recipeUsageCount};${latestInfo}`
    )
  }

  printSection("Order Counts By Fulfillment")
  for (const days of WINDOW_DAYS) {
    const rows = orderCountsByWindow[days]
    const totalOrders = Object.values(rows).reduce((sum, row) => sum + row.orders, 0)
    console.log(`${days} days (${totalOrders.toLocaleString()} orders):`)
    for (const bucket of ["DELIVERY", "PICKUP", "DINE_IN", "UNKNOWN", "OTHER"] as FulfillmentBucket[]) {
      const row = rows[bucket]
      const share = totalOrders > 0 ? pct(row.orders / totalOrders) : "0.0%"
      console.log(
        `- ${fulfillmentLabel(bucket)}: ${row.orders.toLocaleString()} orders (${share}), ` +
          `subtotal ${money(row.subtotal)}, total ${money(row.total)}`
      )
    }
  }

  printSection("Raw Fulfillment Modes")
  for (const row of report.fulfillment.rawModes) {
    console.log(`- ${row.mode}: ${row.orders.toLocaleString()} orders`)
  }

  printSection("Sold Item Mix By Fulfillment - Top 25 Takeaway Qty")
  for (const row of itemMix.slice(0, 25)) {
    console.log(
      `- ${row.itemName} [${row.category}]: takeaway ${row.takeawayQty.toLocaleString()}, ` +
        `delivery ${row.deliveryQty.toLocaleString()}, pickup ${row.pickupQty.toLocaleString()}, ` +
        `dine-in ${row.dineInQty.toLocaleString()}, unknown ${row.unknownQty.toLocaleString()}`
    )
  }

  printSection("Likely Container Demand By Candidate Group")
  for (const group of groupSummary) {
    console.log(
      `${group.group}: takeaway ${group.takeawayQty.toLocaleString()}, ` +
        `dine-in excluded ${group.dineInQty.toLocaleString()}, unknown ${group.unknownQty.toLocaleString()}`
    )
    for (const candidate of group.projectedContainerCostByCandidate) {
      console.log(
        `- ${candidate.container}: unit ${money(candidate.unitCost)}, ` +
          `takeaway projection ${money(candidate.projectedTakeawayCost)}, ` +
          `dine-in exclusion ${money(candidate.projectedDineInExclusion)}`
      )
    }
    console.log("  Top items:")
    for (const item of group.topItems.slice(0, 5)) {
      console.log(
        `  - ${item.itemName} [${item.category}]: ` +
          `takeaway ${item.takeawayQty.toLocaleString()}, dine-in ${item.dineInQty.toLocaleString()}`
      )
    }
  }

  printSection("Basket Packing Model")
  console.log("Delivery and pickup are counted as predicted container demand.")
  console.log("Dine-in is excluded from demand and reported only as avoided container cost.")
  console.log("Capacities:")
  console.log("- medium 6x6: Combo 1, 2 burgers, or 2 loaded fries")
  console.log("- 9x6: 2 burgers + fries, 3 burgers, or 4 burgers")
  console.log("- 1-compartment: 1 fries, 1 burger, or 2 grilled cheese")

  printSection("Top Basket Signatures - 90 Days")
  for (const row of topBasketSignatures.slice(0, 15)) {
    console.log(
      `- ${row.signature}: takeaway ${row.takeawayOrders.toLocaleString()}, ` +
        `delivery ${row.fulfillment.DELIVERY.toLocaleString()}, pickup ${row.fulfillment.PICKUP.toLocaleString()}, ` +
        `dine-in ${row.fulfillment.DINE_IN.toLocaleString()}`
    )
    console.log(`  example raw: ${row.rawSignature}`)
  }

  printSection("Predicted Container Units By Scenario")
  for (const windowDemand of scenarioDemandByWindow) {
    console.log(`${windowDemand.days} days:`)
    for (const scenario of windowDemand.scenarios) {
      console.log(
        `- ${scenario.scenario}: total ${formatContainerCounts(scenario.fulfillment.total)}; ` +
          `delivery ${formatContainerCounts(scenario.fulfillment.DELIVERY)}; ` +
          `pickup ${formatContainerCounts(scenario.fulfillment.PICKUP)}; ` +
          `projected cost ${money(scenario.projectedCost)}`
      )
      console.log(
        `  dine-in excluded ${formatContainerCounts(scenario.dineInExcluded)} ` +
          `(avoided ${money(scenario.dineInAvoidedCost)}); ` +
          `unclassified takeaway orders ${scenario.unclassifiedTakeawayOrders.toLocaleString()}`
      )
    }
  }

  printSection("Invoice-Purchased Container Units")
  for (const windowPurchases of invoicePurchasesByWindow) {
    console.log(`${windowPurchases.days} days:`)
    for (const group of Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[]) {
      const row = windowPurchases.groups[group]
      console.log(
        `- ${row.label}: ${formatQty(row.purchasedUnits)} each, spend ${money(row.spend)}, ` +
          `weighted unit ${money(row.weightedUnitCost)}, lines ${row.invoiceLineCount}`
      )
    }
  }

  printSection("Scenario Fit Score")
  for (const windowFit of scenarioFitByWindow) {
    console.log(`${windowFit.days} days:`)
    for (const scenario of windowFit.scenarios) {
      console.log(`- ${scenario.scenario}: total absolute dollar gap ${money(scenario.totalAbsDollarGap)}`)
      for (const group of Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[]) {
        const row = scenario.groups[group]
        console.log(
          `  ${row.label}: predicted ${formatQty(row.predictedUnits)}, purchased ${formatQty(row.purchasedUnits)}, ` +
            `gap ${formatQty(row.gapUnits)}, utilization ${
              row.utilizationPct == null ? "-" : pct(row.utilizationPct)
            }, dollar gap ${money(row.dollarGap)}`
        )
      }
    }
  }

  printSection("Unclassified Or Ambiguous Baskets")
  if (unclassifiedItems.length === 0) {
    console.log("No unclassified takeaway items found.")
  } else {
    console.log("Top unclassified/ambiguous item names:")
    for (const item of unclassifiedItems.slice(0, 12)) {
      console.log(
        `- ${item.name}: takeaway qty ${formatQty(item.takeawayQty)}, dine-in qty ${formatQty(
          item.dineInQty
        )}, orders ${item.orderCount.toLocaleString()} (${item.reason})`
      )
    }
  }
  if (ambiguousBaskets.length > 0) {
    console.log("Top basket signatures needing owner review:")
    for (const basket of ambiguousBaskets.slice(0, 8)) {
      console.log(
        `- ${basket.signature}: takeaway orders ${basket.takeawayOrders.toLocaleString()}, ` +
          `all orders ${basket.orders.toLocaleString()}`
      )
      console.log(`  raw: ${basket.rawSignature}`)
    }
  }

  printSection("Recommended Mapping Candidates")
  console.log("Review before implementing. Suggested next step is fulfillment-aware packaging COGS:")
  console.log("- Apply container extras only to delivery and pickup orders.")
  console.log("- Exclude dine-in orders from container extras.")
  console.log("- Keep existing bag and napkin recipe lines unchanged until a separate audit confirms migration.")
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
