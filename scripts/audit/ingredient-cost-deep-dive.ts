// scripts/audit/ingredient-cost-deep-dive.ts
//
// Read-only DB audit for ingredient-cost anomalies that can distort recipe
// COGS. It writes local report artifacts only; it never mutates database rows.
//
// Usage:
//   ./node_modules/.bin/tsx scripts/audit/ingredient-cost-deep-dive.ts
//   ./node_modules/.bin/tsx scripts/audit/ingredient-cost-deep-dive.ts --json
//   ./node_modules/.bin/tsx scripts/audit/ingredient-cost-deep-dive.ts --since 2026-01-01

import fs from "fs"
import path from "path"
import { loadEnvLocal, money } from "./lib"

loadEnvLocal()

type Recommendation = "FIX_NOW" | "OWNER_REVIEW" | "GUARDRAIL" | "INFO"
type Severity = "CRITICAL" | "WARNING" | "INFO"

type InvoiceLine = {
  id: string
  canonicalIngredientId: string | null
  sku: string | null
  productName: string
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
  invoice: {
    vendorName: string
    invoiceNumber: string | null
    invoiceDate: Date | null
    isReturn: boolean
  }
}

type RecipeUse = {
  id: string
  quantity: number
  unit: string
  recipe: {
    id: string
    itemName: string
    category: string
    isSellable: boolean
  }
}

type CanonicalForAudit = {
  id: string
  name: string
  recipeUnit: string | null
  costPerRecipeUnit: number | null
  costSource: string | null
  costLocked: boolean
  recipeIngredients: RecipeUse[]
  invoiceLineItems: InvoiceLine[]
}

type DerivedLine = {
  canonicalId: string
  canonicalName: string
  recipeUnit: string
  currentCost: number | null
  costSource: string | null
  costLocked: boolean
  recipeUses: number
  recipeUseLabels: string[]
  line: InvoiceLine
  derivedCost: number
}

type Finding = {
  recommendation: Recommendation
  severity: Severity
  check: string
  title: string
  message: string
  canonicalName?: string
  invoice?: string | null
  vendor?: string
  sku?: string | null
  date?: string | null
  derivedCost?: number | null
  expectedCost?: number | null
  currentCost?: number | null
  ratio?: number | null
  estimatedImpactDollars?: number | null
  details?: Record<string, unknown>
}

type ImpactRow = {
  canonicalName: string
  recipeName: string
  category: string
  store: string
  firstDate: string | null
  lastDate: string | null
  rows: number
  qtySold: number
  revenue: number
  lineCost: number
  deltaPerSold: number
  estimatedImpactDollars: number
}

const DEFAULT_SINCE = "2026-01-01"
const OUT_DIR = path.resolve(process.cwd(), "tmp/ingredient-cost-deep-dive")

function arg(name: string): boolean {
  return process.argv.includes(name)
}

function valueArg(name: string): string | null {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function parseSince(): Date {
  const raw = valueArg("--since") ?? DEFAULT_SINCE
  const d = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid --since date: ${raw}`)
  return d
}

function dateKey(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
}

function safeNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function ratio(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Number.POSITIVE_INFINITY
  return Math.max(a / b, b / a)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const arr = out.get(k) ?? []
    arr.push(row)
    out.set(k, arr)
  }
  return out
}

function lineSignature(line: InvoiceLine): string {
  return [
    line.unit ?? "-",
    line.packSize ?? "-",
    line.unitSize ?? "-",
    line.unitSizeUom ?? "-",
  ].join(" x ")
}

function lineLabel(line: InvoiceLine): string {
  return `${line.invoice.vendorName} #${line.invoice.invoiceNumber ?? "-"} ${dateKey(line.invoice.invoiceDate) ?? "-"} sku=${line.sku ?? "-"}`
}

function csvEscape(value: unknown): string {
  if (value == null) return ""
  const s = value instanceof Date ? value.toISOString() : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function writeCsv(file: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    fs.writeFileSync(file, "")
    return
  }
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      Object.keys(row).forEach((k) => acc.add(k))
      return acc
    }, new Set())
  )
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","))
  }
  fs.writeFileSync(file, lines.join("\n"))
}

function recommendationFor(canonicalName: string, currentCost: number | null, derivedCost: number, isLocked: boolean): Recommendation {
  const name = canonicalName.toLowerCase()
  if (name.includes("house sauce") && derivedCost > 1) return "FIX_NOW"
  if (name.includes("lettuce")) return "OWNER_REVIEW"
  if (isLocked && currentCost != null && ratio(currentCost, derivedCost) >= 10) return "GUARDRAIL"
  return "INFO"
}

function metadataIssue(line: InvoiceLine, siblingLines: InvoiceLine[], derivedCost: number, baselineCost: number | null): string | null {
  const uom = line.unitSizeUom?.toLowerCase() ?? ""
  const siblingUoms = new Set(siblingLines.map((l) => l.unitSizeUom?.toLowerCase()).filter(Boolean))
  const siblingPackSizes = new Set(siblingLines.map((l) => l.packSize).filter((n): n is number => n != null))
  const costRatio = baselineCost && baselineCost > 0 ? ratio(derivedCost, baselineCost) : 1

  if ((line.packSize == null || line.unitSize == null || line.unitSizeUom == null) && costRatio >= 10) {
    return "missing pack metadata makes invoice unit look like recipe unit"
  }
  if (uom === "oz" && siblingUoms.has("lb") && costRatio >= 3) {
    return "unitSizeUom disagrees with sibling lines (OZ vs LB)"
  }
  if ((line.packSize === 11 || line.packSize === 12 || line.packSize === 1) && (siblingPackSizes.has(112) || siblingPackSizes.has(124)) && costRatio >= 3) {
    return "packSize looks truncated or split from 112/124 count pack"
  }
  if ((line.unitSize === 11 || line.unitSize === 12) && (siblingPackSizes.has(112) || siblingPackSizes.has(124)) && costRatio >= 3) {
    return "unitSize/packSize likely swapped or truncated"
  }
  return null
}

function isSuspectMetadata(line: InvoiceLine, siblingLines: InvoiceLine[], derivedCost: number, baselineCost: number | null): boolean {
  return metadataIssue(line, siblingLines, derivedCost, baselineCost) != null
}

function latestSaneLine(lines: DerivedLine[], baselineCost: number | null): DerivedLine | null {
  const sorted = [...lines].sort((a, b) => {
    const ad = a.line.invoice.invoiceDate?.getTime() ?? 0
    const bd = b.line.invoice.invoiceDate?.getTime() ?? 0
    return bd - ad
  })
  for (const line of sorted) {
    const siblings = lines.map((l) => l.line)
    if (!isSuspectMetadata(line.line, siblings, line.derivedCost, baselineCost)) {
      return line
    }
  }
  return null
}

async function directRecipeImpact(input: {
  prisma: any
  computeIngredientLineCost: (args: {
    ingredientQuantity: number
    ingredientUnit: string
    costUnitCost: number
    costUnit: string
  }) => { lineCost: number; qtyInCostUnit: number | null }
  canonical: CanonicalForAudit
  badCost: number
  expectedCost: number
  startDate: Date
  endDate: Date | null
}): Promise<ImpactRow[]> {
  const { prisma, computeIngredientLineCost, canonical, badCost, expectedCost, startDate, endDate } = input
  if (!canonical.recipeUnit) return []
  const diff = badCost - expectedCost
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.000001) return []

  const impacts: ImpactRow[] = []
  for (const use of canonical.recipeIngredients) {
    if (!use.recipe.isSellable) continue
    const converted = computeIngredientLineCost({
      ingredientQuantity: use.quantity,
      ingredientUnit: use.unit,
      costUnitCost: diff,
      costUnit: canonical.recipeUnit,
    })
    if (converted.qtyInCostUnit == null || Math.abs(converted.lineCost) < 0.000001) continue
    const overstatedUnitThreshold =
      diff > 0 ? Math.max(1, Math.abs(converted.lineCost) * 0.5) : null

    const rows = await prisma.dailyCogsItem.groupBy({
      by: ["storeId"],
      where: {
        recipeId: use.recipe.id,
        date: endDate ? { gte: startDate, lt: endDate } : { gte: startDate },
        ...(overstatedUnitThreshold == null
          ? {}
          : { unitCost: { gt: overstatedUnitThreshold } }),
      },
      _count: { _all: true },
      _sum: { qtySold: true, salesRevenue: true, lineCost: true },
      _min: { date: true },
      _max: { date: true },
    })
    if (rows.length === 0) continue
    const stores = await prisma.store.findMany({
      where: { id: { in: rows.map((r: any) => r.storeId) } },
      select: { id: true, name: true },
    })
    const storeById = new Map(stores.map((s: any) => [s.id, s.name]))
    for (const row of rows) {
      const qty = safeNumber(row._sum.qtySold)
      impacts.push({
        canonicalName: canonical.name,
        recipeName: use.recipe.itemName,
        category: use.recipe.category,
        store: storeById.get(row.storeId) ?? row.storeId,
        firstDate: dateKey(row._min.date),
        lastDate: dateKey(row._max.date),
        rows: Number(row._count._all ?? 0),
        qtySold: qty,
        revenue: safeNumber(row._sum.salesRevenue),
        lineCost: safeNumber(row._sum.lineCost),
        deltaPerSold: converted.lineCost,
        estimatedImpactDollars: qty * converted.lineCost,
      })
    }
  }
  return impacts
}

async function modifierImpact(input: {
  prisma: any
  computeIngredientLineCost: (args: {
    ingredientQuantity: number
    ingredientUnit: string
    costUnitCost: number
    costUnit: string
  }) => { lineCost: number; qtyInCostUnit: number | null }
  canonical: CanonicalForAudit
  fromCost: number
  toCost: number
  since: Date
}): Promise<ImpactRow[]> {
  const { prisma, computeIngredientLineCost, canonical, fromCost, toCost, since } = input
  if (!canonical.recipeUnit) return []
  const diff = toCost - fromCost
  const impacts: ImpactRow[] = []

  for (const use of canonical.recipeIngredients) {
    if (use.recipe.isSellable) continue
    const converted = computeIngredientLineCost({
      ingredientQuantity: use.quantity,
      ingredientUnit: use.unit,
      costUnitCost: diff,
      costUnit: canonical.recipeUnit,
    })
    if (converted.qtyInCostUnit == null || Math.abs(converted.lineCost) < 0.000001) continue

    const mappings = await prisma.otterSubItemMapping.findMany({
      where: { recipeId: use.recipe.id },
      select: { storeId: true, skuId: true },
    })
    if (mappings.length === 0) continue

    for (const mapping of mappings) {
      const subItems = await prisma.otterOrderSubItem.findMany({
        where: {
          skuId: mapping.skuId,
          orderItem: {
            order: {
              storeId: mapping.storeId,
              referenceTimeLocal: { gte: since },
            },
          },
        },
        select: {
          quantity: true,
          orderItem: {
            select: {
              quantity: true,
              order: { select: { referenceTimeLocal: true } },
            },
          },
        },
      })
      if (subItems.length === 0) continue
      let uses = 0
      let first: Date | null = null
      let last: Date | null = null
      for (const s of subItems) {
        uses += (s.quantity ?? 1) * (s.orderItem?.quantity ?? 1)
        const d = s.orderItem?.order?.referenceTimeLocal ?? null
        if (d && (!first || d < first)) first = d
        if (d && (!last || d > last)) last = d
      }
      const store = await prisma.store.findUnique({
        where: { id: mapping.storeId },
        select: { name: true },
      })
      impacts.push({
        canonicalName: canonical.name,
        recipeName: use.recipe.itemName,
        category: use.recipe.category,
        store: store?.name ?? mapping.storeId,
        firstDate: dateKey(first),
        lastDate: dateKey(last),
        rows: subItems.length,
        qtySold: uses,
        revenue: 0,
        lineCost: 0,
        deltaPerSold: converted.lineCost,
        estimatedImpactDollars: uses * converted.lineCost,
      })
    }
  }

  return impacts
}

function markdown(input: {
  generatedAt: Date
  since: Date
  findings: Finding[]
  impacts: ImpactRow[]
  outlierLines: Array<Record<string, unknown>>
  reportPaths: string[]
}): string {
  const byRecommendation = groupBy(input.findings, (f) => f.recommendation)
  const topFindings = [...input.findings]
    .sort((a, b) => Math.abs(b.estimatedImpactDollars ?? 0) - Math.abs(a.estimatedImpactDollars ?? 0))
    .slice(0, 15)

  const lines = [
    `# Ingredient Cost Deep Dive - ${input.generatedAt.toISOString()}`,
    "",
    `Read-only audit of recipe-used ingredient costs, invoice-derived unit costs, pack metadata, and estimated COGS impact since ${dateKey(input.since)}.`,
    "",
    "## Summary",
    "",
    `- Findings: ${input.findings.length}`,
    `- Fix now: ${byRecommendation.get("FIX_NOW")?.length ?? 0}`,
    `- Owner review: ${byRecommendation.get("OWNER_REVIEW")?.length ?? 0}`,
    `- Guardrails: ${byRecommendation.get("GUARDRAIL")?.length ?? 0}`,
    `- Impact rows: ${input.impacts.length}`,
    `- Invoice outlier rows: ${input.outlierLines.length}`,
    "",
    "## Top Findings",
    "",
  ]

  if (topFindings.length === 0) {
    lines.push("No findings above thresholds.")
  } else {
    for (const f of topFindings) {
      const impact = f.estimatedImpactDollars == null ? "" : ` Impact: ${money(f.estimatedImpactDollars)}.`
      const ratioText = f.ratio == null ? "" : ` Ratio: ${f.ratio.toFixed(1)}x.`
      lines.push(`- **${f.recommendation} / ${f.severity}** ${f.title}.${impact}${ratioText}`)
      lines.push(`  ${f.message}`)
    }
  }

  lines.push("")
  lines.push("## Artifacts")
  lines.push("")
  for (const p of input.reportPaths) {
    lines.push(`- \`${path.relative(process.cwd(), p)}\``)
  }
  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push("- This script does not update invoices, canonicals, recipes, mappings, or DailyCogsItem rows.")
  lines.push("- Sauce corrections and COGS rematerialization should happen in a separate reviewed step.")
  lines.push("- Lettuce remains owner-review because `each` may mean head, leaf, or portion.")
  lines.push("- Locked manual costs, especially pickles, are reported as guardrails when invoice metadata would produce explosive costs.")
  lines.push("")

  return lines.join("\n")
}

async function main(): Promise<void> {
  const jsonOnly = arg("--json")
  const noWrite = arg("--no-write")
  const since = parseSince()
  const generatedAt = new Date()
  const stamp = timestamp()

  const { prisma } = await import("../../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../../src/lib/ingredient-cost")
  const { computeIngredientLineCost } = await import("../../src/lib/recipe-cost")

  const canonicals = (await prisma.canonicalIngredient.findMany({
    where: {
      recipeIngredients: { some: {} },
      recipeUnit: { not: null },
      invoiceLineItems: { some: { quantity: { gt: 0 }, extendedPrice: { gt: 0 } } },
    },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      recipeIngredients: {
        select: {
          id: true,
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
      invoiceLineItems: {
        where: { quantity: { gt: 0 }, extendedPrice: { gt: 0 } },
        orderBy: { invoice: { invoiceDate: "asc" } },
        select: {
          id: true,
          canonicalIngredientId: true,
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
              vendorName: true,
              invoiceNumber: true,
              invoiceDate: true,
              isReturn: true,
            },
          },
        },
      },
    },
  })) as CanonicalForAudit[]

  const derivedLines: DerivedLine[] = []
  const canonicalById = new Map<string, CanonicalForAudit>()
  for (const canonical of canonicals) {
    canonicalById.set(canonical.id, canonical)
    if (!canonical.recipeUnit) continue
    for (const line of canonical.invoiceLineItems) {
      if (line.invoice.isReturn) continue
      const derivedCost = deriveCostFromLineItem(line, canonical.recipeUnit)
      if (derivedCost == null || !Number.isFinite(derivedCost) || derivedCost <= 0) continue
      derivedLines.push({
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        recipeUnit: canonical.recipeUnit,
        currentCost: canonical.costPerRecipeUnit,
        costSource: canonical.costSource,
        costLocked: canonical.costLocked,
        recipeUses: canonical.recipeIngredients.length,
        recipeUseLabels: canonical.recipeIngredients.map((r) => `${r.recipe.itemName} [${r.recipe.category}]`),
        line,
        derivedCost,
      })
    }
  }

  const findings: Finding[] = []
  const impacts: ImpactRow[] = []
  const outlierRows: Array<Record<string, unknown>> = []
  const derivedByCanonical = groupBy(derivedLines, (l) => l.canonicalId)

  for (const [canonicalId, lines] of derivedByCanonical) {
    const canonical = canonicalById.get(canonicalId)
    if (!canonical || !canonical.recipeUnit) continue
    const costs = lines.map((l) => l.derivedCost)
    const baseline = canonical.costPerRecipeUnit ?? median(costs)
    const med = median(costs)
    const sane = latestSaneLine(lines, baseline)
    const sortedByDate = [...lines].sort((a, b) => {
      const ad = a.line.invoice.invoiceDate?.getTime() ?? 0
      const bd = b.line.invoice.invoiceDate?.getTime() ?? 0
      return ad - bd
    })

    for (let i = 0; i < sortedByDate.length; i++) {
      const line = sortedByDate[i]
      const costRatio = baseline ? ratio(line.derivedCost, baseline) : med ? ratio(line.derivedCost, med) : 1
      const issue = metadataIssue(line.line, lines.map((l) => l.line), line.derivedCost, baseline)
      if (costRatio < 2.5 && !issue) continue

      const nextSane = sortedByDate.slice(i + 1).find((candidate) => {
        return !isSuspectMetadata(candidate.line, lines.map((l) => l.line), candidate.derivedCost, baseline)
      })
      const expected = sane?.derivedCost ?? baseline ?? med ?? null
      const recommendation = recommendationFor(canonical.name, canonical.costPerRecipeUnit, line.derivedCost, canonical.costLocked)
      const severity: Severity = recommendation === "FIX_NOW" ? "CRITICAL" : recommendation === "INFO" ? "INFO" : "WARNING"
      const title = `${canonical.name} derives ${money(line.derivedCost)}/${canonical.recipeUnit} from ${lineLabel(line.line)}`
      findings.push({
        recommendation,
        severity,
        check: "invoice_derived_outlier",
        title,
        message: issue ?? `Invoice-derived cost is ${costRatio.toFixed(1)}x away from baseline ${money(baseline)}/${canonical.recipeUnit}.`,
        canonicalName: canonical.name,
        invoice: line.line.invoice.invoiceNumber,
        vendor: line.line.invoice.vendorName,
        sku: line.line.sku,
        date: dateKey(line.line.invoice.invoiceDate),
        derivedCost: line.derivedCost,
        expectedCost: expected,
        currentCost: canonical.costPerRecipeUnit,
        ratio: costRatio,
        details: {
          lineSignature: lineSignature(line.line),
          medianDerivedCost: med,
          recipeUses: line.recipeUseLabels,
          productName: line.line.productName,
        },
      })

      outlierRows.push({
        recommendation,
        canonicalName: canonical.name,
        recipeUnit: canonical.recipeUnit,
        currentCost: canonical.costPerRecipeUnit,
        expectedCost: expected,
        derivedCost: line.derivedCost,
        ratio: costRatio,
        issue,
        vendor: line.line.invoice.vendorName,
        invoice: line.line.invoice.invoiceNumber,
        date: dateKey(line.line.invoice.invoiceDate),
        sku: line.line.sku,
        productName: line.line.productName,
        quantity: line.line.quantity,
        unit: line.line.unit,
        packSize: line.line.packSize,
        unitSize: line.line.unitSize,
        unitSizeUom: line.line.unitSizeUom,
        unitPrice: line.line.unitPrice,
        extendedPrice: line.line.extendedPrice,
        lineSignature: lineSignature(line.line),
        recipeUses: line.recipeUseLabels.join("; "),
      })

      if (expected != null && line.line.invoice.invoiceDate && recommendation === "FIX_NOW") {
        const direct = await directRecipeImpact({
          prisma,
          computeIngredientLineCost,
          canonical,
          badCost: line.derivedCost,
          expectedCost: expected,
          startDate: line.line.invoice.invoiceDate,
          endDate: nextSane?.line.invoice.invoiceDate ?? null,
        })
        impacts.push(...direct)
      }
    }

    if (canonical.costPerRecipeUnit != null && sane) {
      const driftRatio = ratio(canonical.costPerRecipeUnit, sane.derivedCost)
      const recommendation = recommendationFor(canonical.name, canonical.costPerRecipeUnit, sane.derivedCost, canonical.costLocked)
      if (driftRatio >= 1.5 && Math.abs(canonical.costPerRecipeUnit - sane.derivedCost) >= 0.05) {
        const modifier = await modifierImpact({
          prisma,
          computeIngredientLineCost,
          canonical,
          fromCost: canonical.costPerRecipeUnit,
          toCost: sane.derivedCost,
          since,
        })
        impacts.push(...modifier)
        const totalImpact = modifier.reduce((sum, row) => sum + row.estimatedImpactDollars, 0)
        findings.push({
          recommendation,
          severity: recommendation === "GUARDRAIL" ? "WARNING" : "WARNING",
          check: "current_vs_latest_sane",
          title: `${canonical.name} current cost ${money(canonical.costPerRecipeUnit)}/${canonical.recipeUnit} differs from latest sane invoice ${money(sane.derivedCost)}/${canonical.recipeUnit}`,
          message:
            recommendation === "GUARDRAIL"
              ? "Manual lock is protecting COGS from bad or incomplete invoice metadata; review before unlocking."
              : "Current canonical cost differs materially from the latest sane invoice-derived cost.",
          canonicalName: canonical.name,
          invoice: sane.line.invoice.invoiceNumber,
          vendor: sane.line.invoice.vendorName,
          sku: sane.line.sku,
          date: dateKey(sane.line.invoice.invoiceDate),
          derivedCost: sane.derivedCost,
          currentCost: canonical.costPerRecipeUnit,
          ratio: driftRatio,
          estimatedImpactDollars: totalImpact || null,
          details: {
            costLocked: canonical.costLocked,
            costSource: canonical.costSource,
            latestSaneSignature: lineSignature(sane.line),
            modifierImpactRows: modifier.length,
          },
        })
      }
    }
  }

  const missingOrZero = await prisma.canonicalIngredient.findMany({
    where: {
      recipeIngredients: { some: {} },
      OR: [
        { recipeUnit: null },
        { costPerRecipeUnit: null },
        { costPerRecipeUnit: { lte: 0 } },
      ],
    },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      _count: { select: { invoiceLineItems: true, recipeIngredients: true } },
    },
  })

  for (const c of missingOrZero) {
    findings.push({
      recommendation: "FIX_NOW",
      severity: "CRITICAL",
      check: "recipe_used_missing_or_zero_cost",
      title: `${c.name} is used by recipes but has no usable canonical cost`,
      message: "Recipe-used ingredients should have recipeUnit and a positive costPerRecipeUnit.",
      canonicalName: c.name,
      currentCost: c.costPerRecipeUnit,
      details: {
        recipeUnit: c.recipeUnit,
        costSource: c.costSource,
        costLocked: c.costLocked,
        invoiceLines: c._count.invoiceLineItems,
        recipeUses: c._count.recipeIngredients,
      },
    })
  }

  const zeroExtended = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT c.name, c."recipeUnit", c."costPerRecipeUnit", COUNT(*)::text AS zero_lines,
           ARRAY_AGG(DISTINCT i."vendorName") AS vendors,
           ARRAY_AGG(DISTINCT li.sku) AS skus,
           COUNT(ri.id)::text AS recipe_use_rows
    FROM "CanonicalIngredient" c
    JOIN "InvoiceLineItem" li ON li."canonicalIngredientId" = c.id
    JOIN "Invoice" i ON i.id = li."invoiceId"
    LEFT JOIN "RecipeIngredient" ri ON ri."canonicalIngredientId" = c.id
    WHERE li."extendedPrice" = 0 AND li.quantity > 0
    GROUP BY c.id
    HAVING COUNT(ri.id) > 0
    ORDER BY zero_lines DESC
  `
  for (const row of zeroExtended) {
    findings.push({
      recommendation: "GUARDRAIL",
      severity: "WARNING",
      check: "recipe_used_zero_extended_invoice_line",
      title: `${String(row.name)} has recipe-used zero-extended invoice lines`,
      message: "A zero extended-price invoice line can hydrate a false $0 ingredient cost if not filtered.",
      canonicalName: String(row.name),
      currentCost: safeNumber(row.costPerRecipeUnit),
      details: row,
    })
  }

  for (const impact of impacts) {
    const existing = findings.find((f) => f.canonicalName === impact.canonicalName && f.recommendation === "FIX_NOW")
    if (existing) {
      existing.estimatedImpactDollars = (existing.estimatedImpactDollars ?? 0) + impact.estimatedImpactDollars
    }
  }

  findings.sort((a, b) => {
    const recRank: Record<Recommendation, number> = { FIX_NOW: 0, OWNER_REVIEW: 1, GUARDRAIL: 2, INFO: 3 }
    const r = recRank[a.recommendation] - recRank[b.recommendation]
    if (r !== 0) return r
    return Math.abs(b.estimatedImpactDollars ?? 0) - Math.abs(a.estimatedImpactDollars ?? 0)
  })

  const cogsOverRevenue = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT d."itemName", d.category, COUNT(*)::text AS rows, MIN(d.date) AS first_date, MAX(d.date) AS last_date,
           SUM(d."qtySold") AS qty, SUM(d."salesRevenue") AS revenue, SUM(d."lineCost") AS line_cost,
           AVG(d."unitCost") AS avg_unit, MAX(d."unitCost") AS max_unit
    FROM "DailyCogsItem" d
    WHERE d.category <> 'Packaging' AND d."salesRevenue" > 0 AND d."lineCost" > d."salesRevenue"
    GROUP BY d."itemName", d.category
    ORDER BY SUM(d."lineCost" - d."salesRevenue") DESC
    LIMIT 50
  `

  const recentCogsOverRevenue = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT d."itemName", d.category, COUNT(*)::text AS rows, MIN(d.date) AS first_date, MAX(d.date) AS last_date,
           SUM(d."qtySold") AS qty, SUM(d."salesRevenue") AS revenue, SUM(d."lineCost") AS line_cost,
           AVG(d."unitCost") AS avg_unit, MAX(d."unitCost") AS max_unit
    FROM "DailyCogsItem" d
    WHERE d.category <> 'Packaging'
      AND d.date >= ${new Date("2026-04-23T00:00:00.000Z")}
      AND d."salesRevenue" > 0
      AND d."lineCost" > d."salesRevenue"
    GROUP BY d."itemName", d.category
    ORDER BY SUM(d."lineCost" - d."salesRevenue") DESC
    LIMIT 50
  `

  const artifact = {
    generatedAt: generatedAt.toISOString(),
    since: dateKey(since),
    summary: {
      findings: findings.length,
      fixNow: findings.filter((f) => f.recommendation === "FIX_NOW").length,
      ownerReview: findings.filter((f) => f.recommendation === "OWNER_REVIEW").length,
      guardrail: findings.filter((f) => f.recommendation === "GUARDRAIL").length,
      info: findings.filter((f) => f.recommendation === "INFO").length,
      impactRows: impacts.length,
      invoiceOutlierRows: outlierRows.length,
      recipeUsedMissingOrZero: missingOrZero.length,
      recipeUsedZeroExtended: zeroExtended.length,
      cogsOverRevenueGroups: cogsOverRevenue.length,
      recentCogsOverRevenueGroups: recentCogsOverRevenue.length,
    },
    findings,
    impacts,
    invoiceOutlierRows: outlierRows,
    cogsOverRevenue,
    recentCogsOverRevenue,
  }

  const reportPaths: string[] = []
  if (!noWrite) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const jsonPath = path.join(OUT_DIR, `${stamp}-ingredient-cost-deep-dive.json`)
    const outlierCsv = path.join(OUT_DIR, `${stamp}-invoice-outliers.csv`)
    const impactCsv = path.join(OUT_DIR, `${stamp}-impact-estimates.csv`)
    const cogsCsv = path.join(OUT_DIR, `${stamp}-cogs-over-revenue.csv`)
    const mdPath = path.join(process.cwd(), "docs", "audits", `${stamp}-ingredient-cost-deep-dive.md`)

    fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2))
    writeCsv(outlierCsv, outlierRows)
    writeCsv(impactCsv, impacts as unknown as Array<Record<string, unknown>>)
    writeCsv(cogsCsv, cogsOverRevenue)
    fs.writeFileSync(
      mdPath,
      markdown({
        generatedAt,
        since,
        findings,
        impacts,
        outlierLines: outlierRows,
        reportPaths: [jsonPath, outlierCsv, impactCsv, cogsCsv, mdPath],
      })
    )
    reportPaths.push(jsonPath, outlierCsv, impactCsv, cogsCsv, mdPath)
  }

  if (jsonOnly) {
    console.log(JSON.stringify({ ...artifact, reportPaths }, null, 2))
  } else {
    console.log(`Ingredient cost deep dive - ${generatedAt.toISOString()}`)
    console.log(`Since: ${dateKey(since)}`)
    console.log("")
    console.log("Summary")
    console.log("-------")
    console.log(`Findings: ${artifact.summary.findings}`)
    console.log(`- FIX_NOW: ${artifact.summary.fixNow}`)
    console.log(`- OWNER_REVIEW: ${artifact.summary.ownerReview}`)
    console.log(`- GUARDRAIL: ${artifact.summary.guardrail}`)
    console.log(`- INFO: ${artifact.summary.info}`)
    console.log(`Impact rows: ${artifact.summary.impactRows}`)
    console.log(`Invoice outlier rows: ${artifact.summary.invoiceOutlierRows}`)
    console.log(`COGS > revenue groups after 2026-04-23: ${artifact.summary.recentCogsOverRevenueGroups}`)
    console.log("")
    console.log("Top findings")
    console.log("------------")
    for (const f of findings.slice(0, 12)) {
      const impact = f.estimatedImpactDollars == null ? "" : ` impact=${money(f.estimatedImpactDollars)}`
      const r = f.ratio == null ? "" : ` ratio=${f.ratio.toFixed(1)}x`
      console.log(`- [${f.recommendation}] ${f.title}${impact}${r}`)
      console.log(`  ${f.message}`)
    }
    if (reportPaths.length > 0) {
      console.log("")
      console.log("Artifacts")
      console.log("---------")
      for (const p of reportPaths) console.log(`- ${path.relative(process.cwd(), p)}`)
    }
    console.log("")
    console.log("Read-only DB audit complete.")
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
