import { prisma } from "@/lib/prisma"
import {
  CONTAINER_GROUP_LABELS,
  PACKAGING_SCENARIO,
  containerGroupForCanonical,
  emptyContainerCounts,
  invoiceEachUnits,
  isTakeawayFulfillmentMode,
  normalizeFulfillmentMode,
  packOrder,
  type ContainerCounts,
  type ContainerGroup,
  type FulfillmentBucket,
} from "@/lib/container-packaging"
import type {
  PackagingContainerRow,
  PackagingCostData,
  PackagingFulfillmentRow,
  PackagingInvoiceValidationRow,
  PackagingOrderExample,
} from "@/types/packaging"

type PackagingCostOptions = {
  accountId: string
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
  exampleLimit?: number
}

const GROUPS = Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[]

function resolveDateRange(options: PackagingCostOptions): {
  start: Date
  end: Date
  startDate: string
  endDate: string
} {
  if (options.startDate && options.endDate) {
    return {
      start: new Date(`${options.startDate}T00:00:00.000Z`),
      end: new Date(`${options.endDate}T23:59:59.999Z`),
      startDate: options.startDate,
      endDate: options.endDate,
    }
  }

  const days = options.days ?? 30
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (days === -1) {
    start.setDate(start.getDate() - 1)
    end.setTime(start.getTime())
    end.setHours(23, 59, 59, 999)
  } else if (days !== 1) {
    start.setDate(start.getDate() - days)
  }

  return {
    start,
    end,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function packagingGroupFromItemName(itemName: string): ContainerGroup | null {
  const normalized = itemName.toLowerCase()
  if (normalized.includes("medium 6x6")) return "medium_6x6"
  if (normalized.includes("9x6")) return "large_9x6"
  if (normalized.includes("1-compartment")) return "one_compartment"
  return null
}

function emptyMoneyByGroup(): Record<ContainerGroup, number> {
  return {
    medium_6x6: 0,
    large_9x6: 0,
    one_compartment: 0,
  }
}

function costForCounts(
  counts: ContainerCounts,
  unitCosts: Record<ContainerGroup, number | null>
): number {
  return GROUPS.reduce((sum, group) => {
    const unitCost = unitCosts[group]
    if (unitCost == null) return sum
    return sum + counts[group] * unitCost
  }, 0)
}

function fulfillmentLabel(bucket: FulfillmentBucket): string {
  switch (bucket) {
    case "DELIVERY":
      return "OFO delivery"
    case "PICKUP":
      return "Pickup"
    case "DINE_IN":
      return "Dine-in / in-store"
    case "UNKNOWN":
      return "Unknown"
    case "OTHER":
      return "Other"
  }
}

function sortFulfillment(a: PackagingFulfillmentRow, b: PackagingFulfillmentRow): number {
  const order: Record<FulfillmentBucket, number> = {
    DELIVERY: 0,
    PICKUP: 1,
    DINE_IN: 2,
    UNKNOWN: 3,
    OTHER: 4,
  }
  return order[a.bucket] - order[b.bucket]
}

function exampleWarnings(
  order: ReturnType<typeof packOrder>["classification"]
): string[] {
  return [
    ...order.unclassifiedItems.map((item) => `${item.name}: ${item.reason}`),
    ...order.ambiguousNotes,
  ]
}

export async function getPackagingCostData(
  options: PackagingCostOptions
): Promise<PackagingCostData | null> {
  const range = resolveDateRange(options)

  const stores = await prisma.store.findMany({
    where: {
      accountId: options.accountId,
      ...(options.storeId ? { id: options.storeId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  if (stores.length === 0) return null

  const storeIds = stores.map((store) => store.id)
  const storeNameById = new Map(stores.map((store) => [store.id, store.name]))
  const storeLabel = options.storeId ? stores[0]?.name ?? "Selected store" : "All stores"

  const dailyWhere = {
    storeId: { in: storeIds },
    date: { gte: range.start, lte: range.end },
  }

  const orderWhere = {
    storeId: { in: storeIds },
    referenceTimeLocal: { gte: range.start, lte: range.end },
  }

  const invoiceWhere = {
    accountId: options.accountId,
    invoiceDate: { not: null, gte: range.start, lte: range.end },
    ...(options.storeId ? { storeId: options.storeId } : {}),
  }

  const [
    totalCogsAgg,
    packagingRows,
    fulfillmentRows,
    recentEligibleOrders,
    recentExcludedExampleOrders,
    excludedOrdersForAvoidedCost,
    invoiceLines,
  ] = await Promise.all([
    prisma.dailyCogsItem.aggregate({
      where: dailyWhere,
      _sum: { lineCost: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["itemName"],
      where: { ...dailyWhere, category: "Packaging" },
      _sum: { qtySold: true, lineCost: true },
      _max: { partialCost: true },
    }),
    prisma.otterOrder.groupBy({
      by: ["fulfillmentMode"],
      where: orderWhere,
      _count: { _all: true },
    }),
    prisma.otterOrder.findMany({
      where: {
        ...orderWhere,
        OR: [
          { fulfillmentMode: { contains: "DELIVERY", mode: "insensitive" } },
          { fulfillmentMode: { contains: "PICKUP", mode: "insensitive" } },
          { fulfillmentMode: { contains: "TAKEOUT", mode: "insensitive" } },
          { fulfillmentMode: { contains: "TAKE_OUT", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        externalDisplayId: true,
        storeId: true,
        platform: true,
        referenceTimeLocal: true,
        fulfillmentMode: true,
        items: {
          select: {
            name: true,
            quantity: true,
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
      orderBy: { referenceTimeLocal: "desc" },
      take: Math.max(1, Math.min(options.exampleLimit ?? 12, 18)),
    }),
    prisma.otterOrder.findMany({
      where: {
        ...orderWhere,
        OR: [
          { fulfillmentMode: { contains: "DINE_IN", mode: "insensitive" } },
          { fulfillmentMode: { contains: "DINE IN", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        externalDisplayId: true,
        storeId: true,
        platform: true,
        referenceTimeLocal: true,
        fulfillmentMode: true,
        items: {
          select: {
            name: true,
            quantity: true,
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
      orderBy: { referenceTimeLocal: "desc" },
      take: 6,
    }),
    prisma.otterOrder.findMany({
      where: {
        ...orderWhere,
        OR: [
          { fulfillmentMode: { contains: "DINE_IN", mode: "insensitive" } },
          { fulfillmentMode: { contains: "DINE IN", mode: "insensitive" } },
        ],
      },
      select: {
        fulfillmentMode: true,
        items: {
          select: {
            name: true,
            quantity: true,
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
        invoice: invoiceWhere,
        canonicalIngredient: {
          name: {
            in: [
              "container foam 6x6x3 medium hinged square",
              "container foam 6x6x3 medium white bagged",
              "container foam hinged white 9x6.5x2.5",
              "container foam 1-compartment bagged",
            ],
          },
        },
      },
      select: {
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        extendedPrice: true,
        canonicalIngredient: { select: { name: true } },
      },
    }),
  ])

  const unitsByGroup = emptyContainerCounts()
  const lineCostByGroup = emptyMoneyByGroup()
  const partialByGroup: Record<ContainerGroup, boolean> = {
    medium_6x6: false,
    large_9x6: false,
    one_compartment: false,
  }

  for (const row of packagingRows) {
    const group = packagingGroupFromItemName(row.itemName)
    if (!group) continue
    unitsByGroup[group] += row._sum.qtySold ?? 0
    lineCostByGroup[group] += row._sum.lineCost ?? 0
    partialByGroup[group] = partialByGroup[group] || Boolean(row._max.partialCost)
  }

  const totalPackagingCost = GROUPS.reduce((sum, group) => sum + lineCostByGroup[group], 0)
  const totalPackagingUnits = GROUPS.reduce((sum, group) => sum + unitsByGroup[group], 0)
  const totalCogs = totalCogsAgg._sum.lineCost ?? 0

  const unitCosts = Object.fromEntries(
    GROUPS.map((group) => [
      group,
      unitsByGroup[group] > 0 ? lineCostByGroup[group] / unitsByGroup[group] : null,
    ])
  ) as Record<ContainerGroup, number | null>

  const containers: PackagingContainerRow[] = GROUPS.map((group) => ({
    group,
    label: CONTAINER_GROUP_LABELS[group],
    units: unitsByGroup[group],
    unitCost: unitCosts[group],
    lineCost: lineCostByGroup[group],
    shareOfPackaging:
      totalPackagingCost > 0 ? (lineCostByGroup[group] / totalPackagingCost) * 100 : 0,
    shareOfTotalCogs: totalCogs > 0 ? (lineCostByGroup[group] / totalCogs) * 100 : 0,
    partialCost: partialByGroup[group],
  }))

  const orderCounts: Record<FulfillmentBucket, number> = {
    DELIVERY: 0,
    PICKUP: 0,
    DINE_IN: 0,
    UNKNOWN: 0,
    OTHER: 0,
  }
  for (const row of fulfillmentRows) {
    orderCounts[normalizeFulfillmentMode(row.fulfillmentMode)] += row._count._all
  }
  const totalOrders = Object.values(orderCounts).reduce((sum, count) => sum + count, 0)
  const eligibleOrders = orderCounts.DELIVERY + orderCounts.PICKUP
  const excludedOrders = orderCounts.DINE_IN

  const fulfillment: PackagingFulfillmentRow[] = (
    Object.keys(orderCounts) as FulfillmentBucket[]
  )
    .map((bucket) => ({
      bucket,
      label: fulfillmentLabel(bucket),
      orders: orderCounts[bucket],
      shareOfOrders: totalOrders > 0 ? (orderCounts[bucket] / totalOrders) * 100 : 0,
    }))
    .filter((row) => row.orders > 0)
    .sort(sortFulfillment)

  let avoidedDineInCost = 0
  for (const order of excludedOrdersForAvoidedCost) {
    const packed = packOrder(
      { fulfillmentMode: order.fulfillmentMode, items: order.items },
      PACKAGING_SCENARIO,
    )
    avoidedDineInCost += costForCounts(packed.counts, unitCosts)
  }

  const purchasedUnitsByGroup = emptyContainerCounts()
  const purchasedCostByGroup = emptyMoneyByGroup()
  for (const line of invoiceLines) {
    const canonicalName = line.canonicalIngredient?.name
    if (!canonicalName) continue
    const group = containerGroupForCanonical(canonicalName)
    if (!group) continue
    purchasedUnitsByGroup[group] += invoiceEachUnits(line)
    purchasedCostByGroup[group] += line.extendedPrice
  }

  const validation: PackagingInvoiceValidationRow[] = GROUPS.map((group) => {
    const purchasedUnits = purchasedUnitsByGroup[group]
    const purchasedCost = purchasedCostByGroup[group]
    return {
      group,
      label: CONTAINER_GROUP_LABELS[group],
      inferredUnits: unitsByGroup[group],
      purchasedUnits,
      purchasedCost,
      purchasedUnitCost: purchasedUnits > 0 ? purchasedCost / purchasedUnits : null,
      unitGap: purchasedUnits - unitsByGroup[group],
      utilizationPct: purchasedUnits > 0 ? (unitsByGroup[group] / purchasedUnits) * 100 : null,
    }
  })

  const recentOrders = [...recentEligibleOrders, ...recentExcludedExampleOrders]
    .sort((a, b) => b.referenceTimeLocal.getTime() - a.referenceTimeLocal.getTime())
    .slice(0, options.exampleLimit ?? 18)

  const examples: PackagingOrderExample[] = recentOrders.map((order) => {
    const isCharged = isTakeawayFulfillmentMode(order.fulfillmentMode)
    const packed = packOrder(order, PACKAGING_SCENARIO)
    return {
      orderId: order.id,
      displayId: order.externalDisplayId,
      storeName: storeNameById.get(order.storeId) ?? "Unknown store",
      orderedAt: order.referenceTimeLocal.toISOString(),
      platform: order.platform,
      fulfillmentMode: order.fulfillmentMode,
      fulfillmentBucket: normalizeFulfillmentMode(order.fulfillmentMode),
      chargeStatus: isCharged ? "charged" : "excluded",
      basketSignature: packed.classification.normalizedSignature,
      rawSignature: packed.classification.rawSignature,
      items: order.items,
      containers: isCharged ? packed.counts : emptyContainerCounts(),
      estimatedCost: isCharged ? costForCounts(packed.counts, unitCosts) : 0,
      warnings: exampleWarnings(packed.classification),
      ignoredItems: packed.classification.ignoredItems,
    }
  })

  return {
    dateRange: { startDate: range.startDate, endDate: range.endDate },
    storeLabel,
    scenario: PACKAGING_SCENARIO,
    totals: {
      packagingCogs: totalPackagingCost,
      totalCogs,
      packagingUnits: totalPackagingUnits,
      eligibleOrders,
      excludedOrders,
      totalOrders,
      costPerEligibleOrder:
        eligibleOrders > 0 ? totalPackagingCost / eligibleOrders : null,
      packagingShareOfCogs: totalCogs > 0 ? (totalPackagingCost / totalCogs) * 100 : 0,
      avoidedDineInCost,
    },
    containers,
    fulfillment,
    validation,
    examples,
  }
}
