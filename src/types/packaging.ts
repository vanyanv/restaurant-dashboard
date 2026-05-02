import type { ContainerGroup, FulfillmentBucket } from "@/lib/container-packaging"

export type PackagingDateRange = {
  startDate: string
  endDate: string
}

export type PackagingContainerRow = {
  group: ContainerGroup
  label: string
  units: number
  unitCost: number | null
  lineCost: number
  shareOfPackaging: number
  shareOfTotalCogs: number
  partialCost: boolean
}

export type PackagingInvoiceValidationRow = {
  group: ContainerGroup
  label: string
  inferredUnits: number
  purchasedUnits: number
  purchasedCost: number
  purchasedUnitCost: number | null
  unitGap: number
  utilizationPct: number | null
}

export type PackagingFulfillmentRow = {
  bucket: FulfillmentBucket
  label: string
  orders: number
  shareOfOrders: number
}

export type PackagingExampleItem = {
  name: string
  quantity: number
  subItems: Array<{
    name: string
    quantity: number
    subHeader: string | null
  }>
}

export type PackagingOrderExample = {
  orderId: string
  displayId: string | null
  storeName: string
  orderedAt: string
  platform: string
  fulfillmentMode: string | null
  fulfillmentBucket: FulfillmentBucket
  chargeStatus: "charged" | "excluded"
  basketSignature: string
  rawSignature: string
  items: PackagingExampleItem[]
  containers: Record<ContainerGroup, number>
  estimatedCost: number
  warnings: string[]
  ignoredItems: Array<{ name: string; quantity: number; reason: string }>
}

export type PackagingCostData = {
  dateRange: PackagingDateRange
  storeLabel: string
  scenario: string
  totals: {
    packagingCogs: number
    totalCogs: number
    packagingUnits: number
    eligibleOrders: number
    excludedOrders: number
    totalOrders: number
    costPerEligibleOrder: number | null
    packagingShareOfCogs: number
    avoidedDineInCost: number
  }
  containers: PackagingContainerRow[]
  fulfillment: PackagingFulfillmentRow[]
  validation: PackagingInvoiceValidationRow[]
  examples: PackagingOrderExample[]
}
