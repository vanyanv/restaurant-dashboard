"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { deriveCostFromLineItem } from "@/lib/ingredient-cost"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { computeIngredientLineCost } from "@/lib/recipe-cost"
import { isLikelyNonFood } from "@/app/dashboard/recipes/components/ingredient-picker-utils"
import type {
  IngredientPriceIssueStatus,
  IngredientPriceMonitorFilters,
  IngredientPriceMonitorPoint,
  IngredientPriceMonitoringData,
  IngredientPriceMonitorReceipt,
} from "@/types/ingredient-price-monitor"

const ALLOWED_DAYS = [14, 30, 60, 90, 180] as const

function clampDays(days: number | undefined): number {
  if (!days || !Number.isFinite(days)) return 30
  return ALLOWED_DAYS.includes(days as (typeof ALLOWED_DAYS)[number])
    ? days
    : 30
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function statusLabel(status: IngredientPriceIssueStatus): string {
  switch (status) {
    case "locked":
      return "locked"
    case "stale":
      return "stale"
    case "no-recipe-unit":
      return "unit needed"
    case "conversion-issue":
      return "review"
    case "unpriced":
      return "unpriced"
    default:
      return "current"
  }
}

function matchesStatusFilter(
  rowStatus: IngredientPriceIssueStatus,
  change30dPct: number | null,
  filter: string | undefined
): boolean {
  if (!filter || filter === "all") return true
  if (filter === "review") {
    return rowStatus === "no-recipe-unit" || rowStatus === "conversion-issue" || rowStatus === "unpriced"
  }
  if (filter === "moved") return change30dPct != null && Math.abs(change30dPct) >= 5
  return rowStatus === filter
}

function lineKey(point: Pick<IngredientPriceMonitorPoint, "invoiceId" | "sku" | "date" | "rawUnitPrice">): string {
  return `${point.invoiceId}:${point.sku ?? ""}:${point.date}:${point.rawUnitPrice}`
}

export async function getIngredientPriceMonitoringData(
  filters: IngredientPriceMonitorFilters = {}
): Promise<IngredientPriceMonitoringData> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      generatedAt: new Date().toISOString(),
      days: 30,
      storeId: null,
      stores: [],
      categories: [],
      kpis: {
        matchedLineItems: 0,
        recentLineItems: 0,
        matchedPct: 0,
        updatedIngredients: 0,
        lockedIngredients: 0,
        staleCosts: 0,
        conversionIssues: 0,
      },
      rows: [],
    }
  }

  const accountId = session.user.accountId
  const days = clampDays(filters.days)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days + 1)

  const historyCutoff = new Date()
  historyCutoff.setHours(0, 0, 0, 0)
  historyCutoff.setDate(historyCutoff.getDate() - Math.max(days * 3, 120))

  const thirtyDayBaseline = new Date()
  thirtyDayBaseline.setHours(0, 0, 0, 0)
  thirtyDayBaseline.setDate(thirtyDayBaseline.getDate() - 30)

  const storeId =
    filters.storeId && filters.storeId !== "all" ? filters.storeId : undefined

  const [stores, recentLineItems, matchedLineItems, canonicals] =
    await Promise.all([
      prisma.store.findMany({
        where: { accountId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.invoiceLineItem.count({
        where: {
          quantity: { not: 0 },
          invoice: {
            accountId,
            storeId,
            invoiceDate: { gte: cutoff, not: null },
          },
        },
      }),
      prisma.invoiceLineItem.count({
        where: {
          canonicalIngredientId: { not: null },
          quantity: { not: 0 },
          invoice: {
            accountId,
            storeId,
            invoiceDate: { gte: cutoff, not: null },
          },
        },
      }),
      prisma.canonicalIngredient.findMany({
        where: {
          accountId,
          category:
            filters.category && filters.category !== "all"
              ? filters.category
              : undefined,
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
          },
          invoiceLineItems: {
            where: {
              quantity: { not: 0 },
              invoice: {
                accountId,
                storeId,
                invoiceDate: { gte: historyCutoff, not: null },
              },
            },
            orderBy: { invoice: { invoiceDate: "desc" } },
            take: 36,
            select: {
              id: true,
              sku: true,
              productName: true,
              quantity: true,
              unit: true,
              packSize: true,
              unitSize: true,
              unitSizeUom: true,
              unitPrice: true,
              extendedPrice: true,
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  vendorName: true,
                },
              },
            },
          },
          recipeIngredients: {
            select: {
              quantity: true,
              unit: true,
              recipe: {
                select: {
                  id: true,
                  itemName: true,
                  category: true,
                  isSellable: true,
                },
              },
            },
          },
          _count: { select: { recipeIngredients: true } },
        },
        orderBy: { name: "asc" },
      }),
    ])

  const rows = canonicals
    .filter((c) => !isLikelyNonFood(c.name, c.category))
    .map((c) => {
      const history: IngredientPriceMonitorPoint[] = []
      const receipts: IngredientPriceMonitorReceipt[] = []

      for (const line of [...c.invoiceLineItems].reverse()) {
        const date = isoDate(line.invoice.invoiceDate)
        if (!date) continue
        const vendor = normalizeVendorName(line.invoice.vendorName)
        const match = line.sku
          ? c.skuMatches.find(
              (m) => m.sku === line.sku && m.vendorName === vendor
            ) ?? c.skuMatches.find((m) => m.sku === line.sku)
          : undefined
        const normalized =
          c.recipeUnit != null
            ? deriveCostFromLineItem(
                {
                  quantity: line.quantity,
                  unit: line.unit,
                  packSize: line.packSize,
                  unitSize: line.unitSize,
                  unitSizeUom: line.unitSizeUom,
                  unitPrice: line.unitPrice,
                  extendedPrice: line.extendedPrice,
                },
                c.recipeUnit,
                match
                  ? {
                      conversionFactor: match.conversionFactor,
                      fromUnit: match.fromUnit,
                      toUnit: match.toUnit,
                    }
                  : undefined
              )
            : null
        const point: IngredientPriceMonitorPoint = {
          normalizedUnitPrice: normalized,
          normalizedUnit: normalized == null ? null : c.recipeUnit,
          rawUnitPrice: line.unitPrice,
          rawUnit: line.unit,
          vendor,
          sku: line.sku,
          invoiceId: line.invoice.id,
          invoiceNumber: line.invoice.invoiceNumber,
          date,
        }
        history.push(point)
        receipts.push({
          ...point,
          productName: line.productName,
          quantity: line.quantity,
          extendedPrice: line.extendedPrice,
        })
      }

      const latestLine = c.invoiceLineItems[0] ?? null
      const latestPoint = latestLine ? history.at(-1) ?? null : null
      const normalizedPoints = history.filter(
        (p): p is IngredientPriceMonitorPoint & { normalizedUnitPrice: number } =>
          p.normalizedUnitPrice != null
      )
      const latestNormalized = normalizedPoints.at(-1) ?? null
      const baseline = [...normalizedPoints]
        .reverse()
        .find((p) => new Date(p.date).getTime() <= thirtyDayBaseline.getTime())
      const change30dPct =
        latestNormalized && baseline && baseline.normalizedUnitPrice > 0
          ? ((latestNormalized.normalizedUnitPrice - baseline.normalizedUnitPrice) /
              baseline.normalizedUnitPrice) *
            100
          : null

      const currentNormalizedCost =
        c.costPerRecipeUnit ?? latestNormalized?.normalizedUnitPrice ?? null
      const currentUnit = c.recipeUnit ?? latestNormalized?.normalizedUnit ?? null
      const source: "manual" | "invoice" | null =
        c.costSource === "manual" || c.costSource === "invoice"
          ? c.costSource
          : null
      const latestDate = latestLine?.invoice.invoiceDate ?? null
      const latestInRange = latestDate != null && latestDate >= cutoff

      let status: IngredientPriceIssueStatus = "ok"
      let issueDetail = "Latest matched invoice agrees with the ingredient cost."
      if (!currentNormalizedCost && !latestNormalized) {
        status = "unpriced"
        issueDetail = "No normalized invoice price is available for recipes."
      } else if (latestLine && !c.recipeUnit) {
        status = "no-recipe-unit"
        issueDetail = "Set a recipe unit before invoice prices can flow into recipes."
      } else if (latestLine && c.recipeUnit && !latestPoint?.normalizedUnitPrice) {
        status = "conversion-issue"
        issueDetail = "The latest invoice unit cannot convert into the recipe unit."
      } else if (c.costLocked) {
        status = "locked"
        issueDetail = "Ingredient cost is locked; invoice movement is shown but not applied."
      } else if (!latestInRange) {
        status = "stale"
        issueDetail = `No matched invoice line in the last ${days} days.`
      }

      const menuImpact = c.recipeIngredients
        .slice(0, 6)
        .map((ri) => {
          let lineCost: number | null = null
          let missingCost = true
          if (currentNormalizedCost != null && currentUnit) {
            const computed = computeIngredientLineCost({
              ingredientQuantity: ri.quantity,
              ingredientUnit: ri.unit,
              costUnitCost: currentNormalizedCost,
              costUnit: currentUnit,
            })
            if (computed.qtyInCostUnit != null) {
              lineCost = computed.lineCost
              missingCost = false
            }
          }
          return {
            recipeId: ri.recipe.id,
            recipeName: ri.recipe.itemName,
            category: ri.recipe.category,
            quantity: ri.quantity,
            unit: ri.unit,
            lineCost,
            missingCost,
          }
        })
        .sort((a, b) => (b.lineCost ?? -1) - (a.lineCost ?? -1))

      return {
        canonicalIngredientId: c.id,
        name: c.name,
        category: c.category,
        recipeUnit: c.recipeUnit,
        currentNormalizedCost,
        currentUnit,
        source,
        costLocked: c.costLocked,
        latestInvoiceVendor: latestLine
          ? normalizeVendorName(latestLine.invoice.vendorName)
          : null,
        latestInvoiceSku: latestLine?.sku ?? null,
        latestInvoiceDate: isoDate(latestDate),
        latestInvoiceId: latestLine?.invoice.id ?? null,
        latestInvoiceNumber: latestLine?.invoice.invoiceNumber ?? null,
        latestInvoiceNormalizedCost: latestPoint?.normalizedUnitPrice ?? null,
        latestInvoiceRawUnitPrice: latestLine?.unitPrice ?? null,
        latestInvoiceRawUnit: latestLine?.unit ?? null,
        change30dPct,
        recipeUsageCount: c._count.recipeIngredients,
        status,
        statusLabel: statusLabel(status),
        issueDetail,
        history,
        receipts: receipts
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .filter((p, idx, arr) => arr.findIndex((q) => lineKey(q) === lineKey(p)) === idx)
          .slice(0, 10),
        menuImpact,
      }
    })
    .filter((row) =>
      matchesStatusFilter(row.status, row.change30dPct, filters.status)
    )
    .sort((a, b) => {
      const severity: Record<IngredientPriceIssueStatus, number> = {
        "conversion-issue": 6,
        "no-recipe-unit": 5,
        unpriced: 4,
        locked: 3,
        stale: 2,
        ok: 0,
      }
      const sev = severity[b.status] - severity[a.status]
      if (sev !== 0) return sev
      const moved =
        Math.abs(b.change30dPct ?? 0) - Math.abs(a.change30dPct ?? 0)
      if (moved !== 0) return moved
      return (b.recipeUsageCount ?? 0) - (a.recipeUsageCount ?? 0)
    })

  const categories = Array.from(
    new Set(
      canonicals
        .filter((c) => !isLikelyNonFood(c.name, c.category))
        .map((c) => c.category)
        .filter((c): c is string => !!c)
    )
  ).sort((a, b) => a.localeCompare(b))

  const kpis = {
    matchedLineItems,
    recentLineItems,
    matchedPct:
      recentLineItems > 0 ? Math.round((matchedLineItems / recentLineItems) * 100) : 0,
    updatedIngredients: rows.filter(
      (r) => r.status === "ok" && r.latestInvoiceDate != null
    ).length,
    lockedIngredients: rows.filter((r) => r.costLocked).length,
    staleCosts: rows.filter((r) => r.status === "stale").length,
    conversionIssues: rows.filter(
      (r) => r.status === "conversion-issue" || r.status === "no-recipe-unit"
    ).length,
  }

  return {
    generatedAt: new Date().toISOString(),
    days,
    storeId: storeId ?? null,
    stores,
    categories,
    kpis,
    rows,
  }
}
