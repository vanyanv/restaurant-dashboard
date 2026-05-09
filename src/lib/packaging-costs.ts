import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import {
  CONTAINER_GROUP_LABELS,
  PACKAGING_COST_AWARE_SCENARIO,
  PACKAGING_SCENARIO,
  containerGroupForCanonical,
  emptyContainerCounts,
  invoiceEachUnits,
  isTakeawayFulfillmentMode,
  normalizeFulfillmentMode,
  packOrderCostAware,
  type BasketClassification,
  type ContainerCounts,
  type ContainerGroup,
  type FulfillmentBucket,
} from "@/lib/container-packaging"
import {
  summarizeAvoidedDineInCost,
  type AvoidedCostSignatureRow,
} from "@/lib/packaging-cost-aggregation"
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

  // UTC day boundaries: DailyCogsItem.date is stored at UTC midnight, so a
  // local-TZ window on a non-UTC server (e.g. PDT dev) misses or duplicates
  // boundary rows. Mirrors the e96e828 pnl.ts fix.
  const days = options.days ?? 30
  const end = new Date()
  end.setUTCHours(23, 59, 59, 999)
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  if (days === -1) {
    start.setUTCDate(start.getUTCDate() - 1)
    end.setTime(start.getTime())
    end.setUTCHours(23, 59, 59, 999)
  } else if (days !== 1) {
    start.setUTCDate(start.getUTCDate() - days)
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

function exampleWarnings(order: BasketClassification): string[] {
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
    avoidedCostSignatureRows,
    invoiceLines,
  ] = await Promise.all([
    prisma.dailyCogsItem.aggregate({
      where: dailyWhere,
      _sum: { lineCost: true },
    }),
    prisma.dailyCogsItem.findMany({
      where: { ...dailyWhere, category: "Packaging" },
      select: {
        itemName: true,
        qtySold: true,
        lineCost: true,
        partialCost: true,
      },
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
    // Avoided dine-in cost: pre-group orders by basket signature in Postgres
    // so we never materialize every dine-in order's nested items in JS. Each
    // returned row carries a unique (fulfillmentMode, items[]) basket plus an
    // `occurrences` count; the JS classifier then runs once per signature
    // (often 10–100×) instead of once per order (often 1000s).
    prisma.$queryRaw<
      Array<{
        fulfillmentMode: string | null
        items: Array<{
          name: string
          quantity: number
          subItems: Array<{
            name: string
            quantity: number
            subHeader: string | null
          }>
        }>
        occurrences: bigint | number
      }>
    >(Prisma.sql`
      WITH dine_in_orders AS (
        SELECT o.id, o."fulfillmentMode"
        FROM "OtterOrder" o
        WHERE o."storeId" = ANY(${storeIds}::text[])
          AND o."referenceTimeLocal" >= ${range.start}
          AND o."referenceTimeLocal" <= ${range.end}
          AND (
            o."fulfillmentMode" ILIKE '%dine_in%'
            OR o."fulfillmentMode" ILIKE '%dine in%'
          )
      ),
      item_subitems AS (
        SELECT
          i.id          AS item_id,
          i."orderId"   AS order_id,
          i.name        AS item_name,
          i.quantity    AS item_qty,
          (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'name', s.name,
                  'quantity', s.quantity,
                  'subHeader', s."subHeader"
                )
                ORDER BY s.name, s.quantity, COALESCE(s."subHeader", '')
              ),
              '[]'::jsonb
            )
            FROM "OtterOrderSubItem" s
            WHERE s."orderItemId" = i.id
          ) AS sub_items
        FROM "OtterOrderItem" i
        WHERE i."orderId" IN (SELECT id FROM dine_in_orders)
      ),
      order_baskets AS (
        SELECT
          isi.order_id,
          jsonb_agg(
            jsonb_build_object(
              'name', isi.item_name,
              'quantity', isi.item_qty,
              'subItems', isi.sub_items
            )
            ORDER BY isi.item_name, isi.item_qty
          ) AS items
        FROM item_subitems isi
        GROUP BY isi.order_id
      )
      SELECT
        d."fulfillmentMode" AS "fulfillmentMode",
        ob.items            AS "items",
        COUNT(*)            AS "occurrences"
      FROM dine_in_orders d
      JOIN order_baskets ob ON ob.order_id = d.id
      GROUP BY d."fulfillmentMode", ob.items
    `),
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
    unitsByGroup[group] += row.qtySold
    lineCostByGroup[group] += row.lineCost
    partialByGroup[group] = partialByGroup[group] || row.partialCost
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

  const avoidedCostRows: AvoidedCostSignatureRow[] = avoidedCostSignatureRows.map(
    (row) => ({
      fulfillmentMode: row.fulfillmentMode,
      items: row.items,
      occurrences: Number(row.occurrences),
    })
  )
  const avoidedDineInCost = summarizeAvoidedDineInCost(avoidedCostRows, unitCosts)

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
    const packed = packOrderCostAware(order, unitCosts, PACKAGING_SCENARIO)
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
    scenario: PACKAGING_COST_AWARE_SCENARIO,
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
