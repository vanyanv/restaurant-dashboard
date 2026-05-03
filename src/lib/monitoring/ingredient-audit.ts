import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

export type IngredientAuditStatus = "matched" | "unmatched" | "suspect"

export type IngredientAuditRow = {
  rowId: string
  status: IngredientAuditStatus
  issueReasons: string[]
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  category: string | null
  occurrenceCount: number
  totalSpend: number
  firstInvoiceDate: string | null
  lastInvoiceDate: string | null
  unmatchedLineCount: number
  canonicalDistinctCount: number
  sampleLineItemId: string
  latestInvoiceId: string
  latestInvoiceNumber: string
  latestInvoiceDate: string | null
  latestInvoiceHasPdf: boolean
  latestQuantity: number
  latestUnitPrice: number
  latestExtendedPrice: number
  latestMatchSource: string | null
  canonicalIngredientId: string | null
  canonicalName: string | null
  canonicalCategory: string | null
  canonicalUnit: string | null
  currentCost: number | null
  costSource: "manual" | "invoice" | null
}

type RawAuditRow = {
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  category: string | null
  occurrenceCount: number
  totalSpend: number | null
  firstInvoiceDate: Date | null
  lastInvoiceDate: Date | null
  unmatchedLineCount: number
  canonicalDistinctCount: number
  sampleLineItemId: string
  latestInvoiceId: string
  latestInvoiceNumber: string
  latestInvoiceDate: Date | null
  latestInvoiceHasPdf: boolean
  latestQuantity: number
  latestUnitPrice: number
  latestExtendedPrice: number
  latestMatchSource: string | null
  canonicalIngredientId: string | null
  canonicalName: string | null
  canonicalCategory: string | null
  canonicalUnit: string | null
  currentCost: number | null
  costSource: string | null
}

const NOISE_PATTERN = /\b(return|returned|cancelled|canceled|credit|memo|surcharge|chgs?|adjustment)\b/i

const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "brand",
  "fresh",
  "frozen",
  "case",
  "each",
  "pack",
  "bag",
  "box",
  "bulk",
])

export async function getIngredientAuditRows(
  accountId: string,
): Promise<IngredientAuditRow[]> {
  const rows = await prisma.$queryRaw<RawAuditRow[]>(Prisma.sql`
    WITH line_base AS (
      SELECT
        i."vendorName" AS "vendorName",
        li.sku AS "sku",
        li."productName" AS "productName",
        LOWER(li."productName") AS "productKey",
        li.unit AS "unit",
        li.category AS "category",
        li.id AS "lineItemId",
        li.quantity AS "quantity",
        li."unitPrice" AS "unitPrice",
        li."extendedPrice" AS "extendedPrice",
        li."matchSource" AS "matchSource",
        li."canonicalIngredientId" AS "canonicalIngredientId",
        i.id AS "invoiceId",
        i."invoiceNumber" AS "invoiceNumber",
        i."invoiceDate" AS "invoiceDate",
        i."createdAt" AS "invoiceCreatedAt",
        i."pdfBlobPathname" IS NOT NULL AS "invoiceHasPdf",
        li."lineNumber" AS "lineNumber",
        ci.name AS "canonicalName",
        ci.category AS "canonicalCategory",
        COALESCE(ci."recipeUnit", ci."defaultUnit") AS "canonicalUnit",
        ci."costPerRecipeUnit" AS "currentCost",
        ci."costSource" AS "costSource"
      FROM "InvoiceLineItem" li
      JOIN "Invoice" i ON i.id = li."invoiceId"
      LEFT JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
      WHERE i."accountId" = ${accountId}
    ),
    latest AS (
      SELECT DISTINCT ON ("vendorName", COALESCE(sku, ''), "productKey", COALESCE(unit, ''))
        *
      FROM line_base
      ORDER BY
        "vendorName",
        COALESCE(sku, ''),
        "productKey",
        COALESCE(unit, ''),
        "invoiceDate" DESC NULLS LAST,
        "invoiceCreatedAt" DESC,
        "lineNumber" ASC
    )
      SELECT
        s."vendorName",
        s.sku,
        l."productName",
        s.unit,
      l.category,
      s."occurrenceCount",
      s."totalSpend",
      s."firstInvoiceDate",
      s."lastInvoiceDate",
      s."unmatchedLineCount",
      s."canonicalDistinctCount",
      l."lineItemId" AS "sampleLineItemId",
      l."invoiceId" AS "latestInvoiceId",
      l."invoiceNumber" AS "latestInvoiceNumber",
      l."invoiceDate" AS "latestInvoiceDate",
      l."invoiceHasPdf" AS "latestInvoiceHasPdf",
      l.quantity AS "latestQuantity",
      l."unitPrice" AS "latestUnitPrice",
      l."extendedPrice" AS "latestExtendedPrice",
      l."matchSource" AS "latestMatchSource",
      l."canonicalIngredientId",
      l."canonicalName",
      l."canonicalCategory",
      l."canonicalUnit",
      l."currentCost",
      l."costSource"
    FROM (
      SELECT
        "vendorName",
        sku,
        "productKey",
        unit,
        COUNT(*)::int AS "occurrenceCount",
        SUM("extendedPrice")::float8 AS "totalSpend",
        MIN("invoiceDate") AS "firstInvoiceDate",
        MAX("invoiceDate") AS "lastInvoiceDate",
        COUNT(*) FILTER (WHERE "canonicalIngredientId" IS NULL)::int AS "unmatchedLineCount",
        COUNT(DISTINCT "canonicalIngredientId") FILTER (WHERE "canonicalIngredientId" IS NOT NULL)::int AS "canonicalDistinctCount"
      FROM line_base
      GROUP BY "vendorName", sku, "productKey", unit
    ) s
    JOIN latest l
      ON l."vendorName" = s."vendorName"
     AND COALESCE(l.sku, '') = COALESCE(s.sku, '')
     AND l."productKey" = s."productKey"
     AND COALESCE(l.unit, '') = COALESCE(s.unit, '')
    ORDER BY LOWER(COALESCE(l."canonicalName", l."productName")), s."vendorName", s.sku NULLS LAST
  `)

  return rows.map((row) => {
    const issueReasons = getIssueReasons(row)
    const status: IngredientAuditStatus =
      row.canonicalIngredientId == null
        ? "unmatched"
        : issueReasons.length > 0
          ? "suspect"
          : "matched"

    return {
      rowId: [
        row.vendorName,
        row.sku ?? "",
        row.productName.toLowerCase(),
        row.unit ?? "",
      ].join("::"),
      status,
      issueReasons,
      vendorName: row.vendorName,
      sku: row.sku,
      productName: row.productName,
      unit: row.unit,
      category: row.category,
      occurrenceCount: row.occurrenceCount,
      totalSpend: Number(row.totalSpend ?? 0),
      firstInvoiceDate: formatDate(row.firstInvoiceDate),
      lastInvoiceDate: formatDate(row.lastInvoiceDate),
      unmatchedLineCount: row.unmatchedLineCount,
      canonicalDistinctCount: row.canonicalDistinctCount,
      sampleLineItemId: row.sampleLineItemId,
      latestInvoiceId: row.latestInvoiceId,
      latestInvoiceNumber: row.latestInvoiceNumber,
      latestInvoiceDate: formatDate(row.latestInvoiceDate),
      latestInvoiceHasPdf: row.latestInvoiceHasPdf,
      latestQuantity: row.latestQuantity,
      latestUnitPrice: row.latestUnitPrice,
      latestExtendedPrice: row.latestExtendedPrice,
      latestMatchSource: row.latestMatchSource,
      canonicalIngredientId: row.canonicalIngredientId,
      canonicalName: row.canonicalName,
      canonicalCategory: row.canonicalCategory,
      canonicalUnit: row.canonicalUnit,
      currentCost: row.currentCost,
      costSource:
        row.costSource === "manual" || row.costSource === "invoice"
          ? row.costSource
          : null,
    }
  })
}

function getIssueReasons(row: RawAuditRow): string[] {
  const reasons: string[] = []
  if (row.canonicalIngredientId == null) {
    reasons.push("No canonical ingredient is linked")
  }
  if (row.unmatchedLineCount > 0 && row.canonicalIngredientId != null) {
    reasons.push("Some historical lines in this raw group are still unmatched")
  }
  if (row.canonicalDistinctCount > 1) {
    reasons.push("This raw group has linked to multiple canonicals over time")
  }
  if (NOISE_PATTERN.test(row.productName)) {
    reasons.push("Product text looks like a return, credit, surcharge, or adjustment")
  }
  if (row.canonicalIngredientId != null && row.currentCost == null) {
    reasons.push("Matched canonical has no current cost")
  }
  if (
    row.canonicalIngredientId != null &&
    row.currentCost != null &&
    row.currentCost <= 0
  ) {
    reasons.push("Matched canonical cost is zero or negative")
  }
  if (
    row.canonicalName &&
    !NOISE_PATTERN.test(row.productName) &&
    hasWeakNameOverlap(row.productName, row.canonicalName)
  ) {
    reasons.push("Raw product and canonical name share very little wording")
  }
  return reasons
}

function hasWeakNameOverlap(productName: string, canonicalName: string): boolean {
  const product = tokenSet(productName)
  const canonical = tokenSet(canonicalName)
  if (product.size === 0 || canonical.size === 0) return false
  const overlap = [...product].filter((token) => canonical.has(token)).length
  if (overlap > 0) return false
  const raw = normalizeForContains(productName)
  const canonicalRaw = normalizeForContains(canonicalName)
  return !raw.includes(canonicalRaw) && !canonicalRaw.includes(raw)
}

function tokenSet(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(
    tokens.filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  )
}

function normalizeForContains(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}
