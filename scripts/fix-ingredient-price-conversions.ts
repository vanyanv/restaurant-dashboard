// scripts/fix-ingredient-price-conversions.ts
//
// Dry-run-first audit/fixer for invoice-line ingredient conversion failures.
// It only applies deterministic repairs:
// - known SKU yield metadata from authoring notes
// - bad case-pack extraction when the true case count is known
// - zero extended-price lines where quantity * unitPrice is unambiguous
// - same-vendor/SKU packaging profile reuse for per-each packaging
//
// Usage:
//   ./node_modules/.bin/tsx scripts/fix-ingredient-price-conversions.ts
//   ./node_modules/.bin/tsx scripts/fix-ingredient-price-conversions.ts --apply
//   ./node_modules/.bin/tsx scripts/fix-ingredient-price-conversions.ts --self-test

import fs from "fs"
import path from "path"
import assert from "node:assert/strict"

import { loadEnvLocal } from "./audit/lib"

loadEnvLocal()

type CliArgs = {
  apply: boolean
  accountId?: string
  selfTest: boolean
}

type LinePatch = {
  unit?: string | null
  packSize?: number | null
  unitSize?: number | null
  unitSizeUom?: string | null
  extendedPrice?: number
}

type ConversionPatch = {
  conversionFactor: number
  fromUnit: string
  toUnit: string
}

type InvoiceLine = {
  id: string
  invoiceId: string
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
  canonicalIngredient: {
    id: string
    ownerId: string
    accountId: string
    name: string
    recipeUnit: string | null
    costPerRecipeUnit: number | null
    costLocked: boolean
    _count: { recipeIngredients: number }
  } | null
  invoice: {
    id: string
    ownerId: string
    accountId: string
    vendorName: string
    invoiceNumber: string
    invoiceDate: Date | null
    isReturn: boolean
  }
}

type ExistingSkuMatch = ConversionPatch & {
  id: string
  ownerId: string
  accountId: string
  vendorName: string
  sku: string
  canonicalIngredientId: string
}

type Profile = LinePatch & {
  key: string
  sampleLineId: string
  count: number
  sampleCost: number
}

type ReportAction = {
  kind:
    | "known_explicit_yield"
    | "known_pack_extraction"
    | "same_sku_pack_profile"
    | "zero_extended_price"
  status: "would_apply" | "applied" | "skipped"
  lineItemId?: string
  canonicalIngredientId: string
  canonicalName: string
  vendorName: string
  sku: string | null
  productName: string
  invoiceId?: string
  invoiceNumber?: string
  invoiceDate?: string | null
  reason: string
  basis: string
  beforeCost: number | null
  afterCost: number | null
  recipeUnit: string | null
  patch?: LinePatch | ConversionPatch
  recompute?: unknown
}

type ReviewItem = {
  kind: "missing_recipe_unit" | "manual_review_required" | "excluded_non_recipe_scope"
  lineItemId?: string
  canonicalIngredientId: string
  canonicalName: string
  vendorName: string
  sku: string | null
  productName: string
  invoiceDate?: string | null
  reason: string
  recipeUses: number
  recipeUnit: string | null
  beforeCost: number | null
}

type Report = {
  generatedAt: string
  mode: "dry-run" | "apply"
  accountId: string | null
  counts: Record<string, number>
  actions: ReportAction[]
  review: ReviewItem[]
  reportFiles?: { json: string; markdown: string }
}

const KNOWN_CONVERSIONS = [
  {
    sku: "644",
    name: /american cheese yellow 160/i,
    fromUnit: "LB",
    toUnit: "each",
    conversionFactor: 32,
    basis: "American Cheese Yellow 160: authoring note says 160 slices per 5 lb, so 32 slices/lb.",
    minCost: 0.05,
    maxCost: 0.25,
  },
  {
    sku: "G299",
    name: /peppers? whole yellow|yellow (pepper|chili)/i,
    fromUnit: "GAL",
    toUnit: "each",
    conversionFactor: 120,
    basis: "Peppers Whole Yellow: authoring note says 5-gal tub = 600 chilies, so 120 chilies/gal.",
    minCost: 0.03,
    maxCost: 0.2,
  },
]

const KNOWN_PACK_FIXES = [
  {
    sku: "7370699",
    name: /greeno cup.*20\s*oz/i,
    patch: { unit: "CS", packSize: 1000, unitSize: 1, unitSizeUom: "CT" },
    basis: "Greeno 20 oz cup: current locked cost and authoring note imply $96.55/case / 1000 cups.",
    minCost: 0.04,
    maxCost: 0.2,
  },
]

const PACKAGING_NAME = /\b(cup|lid|tray|bag|container|portion|napkin|towel|fork|spoon|straw|wrap|box|clamshell|carrier)\b/i
const OPERATIONAL_NAME = /\b(fuel surcharge|bleach|sanit|clean|degreaser|equipment|bath tissue|thermal paper|paper roll|can liner)\b/i

function parseArgs(): CliArgs {
  const out: CliArgs = { apply: false, selfTest: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") out.apply = true
    else if (arg === "--dry-run") out.apply = false
    else if (arg === "--self-test") out.selfTest = true
    else if (arg.startsWith("--account-id=")) out.accountId = arg.slice("--account-id=".length)
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: ./node_modules/.bin/tsx scripts/fix-ingredient-price-conversions.ts [--apply] [--account-id=...] [--self-test]\n" +
          "  default      dry-run, write audit report only\n" +
          "  --apply      apply deterministic fixes and then write the report\n" +
          "  --self-test  verify local classification/conversion math without touching the database"
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown arg: ${arg}`)
    }
  }
  return out
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function money(n: number | null | undefined): string {
  return n == null ? "-" : `$${n.toFixed(6)}`
}

function close(a: number | null | undefined, b: number | null | undefined, tolerance = 1e-6): boolean {
  if (a == null || b == null) return a == null && b == null
  return Math.abs(a - b) <= tolerance
}

function roundMoney(n: number): number {
  return Math.round(n * 1000000) / 1000000
}

function profileKey(p: LinePatch): string {
  return JSON.stringify({
    unit: p.unit ?? null,
    packSize: p.packSize ?? null,
    unitSize: p.unitSize ?? null,
    unitSizeUom: p.unitSizeUom ?? null,
  })
}

function lineWithPatch(line: InvoiceLine, patch: LinePatch): InvoiceLine {
  return { ...line, ...patch }
}

function isSameLinePatch(line: InvoiceLine, patch: LinePatch): boolean {
  return (
    line.unit === (patch.unit ?? line.unit) &&
    line.packSize === (patch.packSize ?? line.packSize) &&
    line.unitSize === (patch.unitSize ?? line.unitSize) &&
    line.unitSizeUom === (patch.unitSizeUom ?? line.unitSizeUom) &&
    (patch.extendedPrice == null || close(line.extendedPrice, patch.extendedPrice))
  )
}

function normalizedVendor(raw: string, normalizeVendorName: (raw: string) => string): string {
  return normalizeVendorName(raw)
}

function matchKey(accountId: string, vendorName: string, sku: string): string {
  return `${accountId}::${vendorName}::${sku}`
}

function groupKey(line: InvoiceLine, normalizeVendorName: (raw: string) => string): string | null {
  if (!line.sku || !line.canonicalIngredient) return null
  return `${line.invoice.accountId}::${normalizedVendor(line.invoice.vendorName, normalizeVendorName)}::${line.sku}::${line.canonicalIngredient.id}`
}

function isRecipeScope(line: InvoiceLine): boolean {
  const c = line.canonicalIngredient
  if (!c) return false
  if (c._count.recipeIngredients > 0) return true
  const text = `${c.name} ${line.productName}`
  if (PACKAGING_NAME.test(text)) return true
  if (OPERATIONAL_NAME.test(text)) return false
  return false
}

function isSaneEachCost(cost: number | null, min = 0.001, max = 5): boolean {
  return cost != null && Number.isFinite(cost) && cost >= min && cost <= max
}

function findKnownConversion(line: InvoiceLine) {
  if (!line.sku || !line.canonicalIngredient?.recipeUnit) return null
  return (
    KNOWN_CONVERSIONS.find(
      (k) =>
        k.sku.toLowerCase() === line.sku!.toLowerCase() &&
        k.name.test(`${line.productName} ${line.canonicalIngredient!.name}`) &&
        line.canonicalIngredient!.recipeUnit!.toLowerCase() === k.toUnit.toLowerCase()
    ) ?? null
  )
}

function findKnownPackFix(line: InvoiceLine) {
  if (!line.sku || !line.canonicalIngredient?.recipeUnit) return null
  return (
    KNOWN_PACK_FIXES.find(
      (k) =>
        k.sku.toLowerCase() === line.sku!.toLowerCase() &&
        k.name.test(`${line.productName} ${line.canonicalIngredient!.name}`) &&
        line.canonicalIngredient!.recipeUnit!.toLowerCase() === "each"
    ) ?? null
  )
}

function conversionChanged(existing: ExistingSkuMatch | undefined, patch: ConversionPatch): boolean {
  if (!existing) return true
  return (
    Math.abs(existing.conversionFactor - patch.conversionFactor) > 1e-9 ||
    existing.fromUnit.toLowerCase() !== patch.fromUnit.toLowerCase() ||
    existing.toUnit.toLowerCase() !== patch.toUnit.toLowerCase()
  )
}

async function runSelfTest(): Promise<void> {
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")

  const americanCheese = deriveCostFromLineItem(
    {
      quantity: 750,
      unit: "LB",
      packSize: null,
      unitSize: null,
      unitSizeUom: null,
      unitPrice: 3.85,
      extendedPrice: 2887.5,
    },
    "each",
    { fromUnit: "LB", toUnit: "each", conversionFactor: 32 }
  )
  assert.ok(americanCheese != null)
  assert.ok(Math.abs(americanCheese - 0.1203125) < 1e-9)

  const yellowPeppers = deriveCostFromLineItem(
    {
      quantity: 1,
      unit: "TUB",
      packSize: 1,
      unitSize: 5,
      unitSizeUom: "GAL",
      unitPrice: 48.85,
      extendedPrice: 48.85,
    },
    "each",
    { fromUnit: "GAL", toUnit: "each", conversionFactor: 120 }
  )
  assert.ok(yellowPeppers != null)
  assert.ok(Math.abs(yellowPeppers - 0.08141666666666667) < 1e-9)

  const portionCup = deriveCostFromLineItem(
    {
      quantity: 1,
      unit: "CS",
      packSize: 2500,
      unitSize: 1,
      unitSizeUom: "CT",
      unitPrice: 37.5,
      extendedPrice: 37.5,
    },
    "each"
  )
  assert.equal(portionCup, 0.015)

  const zeroExtendedBefore = deriveCostFromLineItem(
    {
      quantity: 2,
      unit: "CS",
      packSize: 1000,
      unitSize: 1,
      unitSizeUom: "CT",
      unitPrice: 96.55,
      extendedPrice: 0,
    },
    "each"
  )
  assert.equal(zeroExtendedBefore, null)

  const zeroExtendedAfter = deriveCostFromLineItem(
    {
      quantity: 2,
      unit: "CS",
      packSize: 1000,
      unitSize: 1,
      unitSizeUom: "CT",
      unitPrice: 96.55,
      extendedPrice: 193.1,
    },
    "each"
  )
  assert.equal(zeroExtendedAfter, 0.09655)

  console.log("Self-test passed: known conversions, packaging profile math, and zero extended-price repair.")
}

function renderMarkdown(report: Report): string {
  const lines: string[] = []
  lines.push(`# Ingredient Price Conversion Audit`)
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Mode: ${report.mode}`)
  lines.push(`Account: ${report.accountId ?? "all"}`)
  lines.push("")
  lines.push("## Counts")
  lines.push("")
  for (const [key, value] of Object.entries(report.counts)) {
    lines.push(`- ${key}: ${value}`)
  }
  lines.push("")
  lines.push("## Safe Fixes")
  lines.push("")
  if (report.actions.length === 0) {
    lines.push("No deterministic fixes found.")
  } else {
    lines.push("| Status | Kind | Canonical | SKU | Before | After | Reason |")
    lines.push("| --- | --- | --- | --- | ---: | ---: | --- |")
    for (const a of report.actions) {
      lines.push(
        `| ${a.status} | ${a.kind} | ${a.canonicalName} | ${a.sku ?? "-"} | ${money(a.beforeCost)} | ${money(a.afterCost)} | ${a.reason.replace(/\|/g, "/")} |`
      )
    }
  }
  lines.push("")
  lines.push("## Review Items")
  lines.push("")
  if (report.review.length === 0) {
    lines.push("No remaining review items.")
  } else {
    lines.push("| Kind | Canonical | SKU | Unit | Uses | Reason |")
    lines.push("| --- | --- | --- | --- | ---: | --- |")
    for (const r of report.review) {
      lines.push(
        `| ${r.kind} | ${r.canonicalName} | ${r.sku ?? "-"} | ${r.recipeUnit ?? "-"} | ${r.recipeUses} | ${r.reason.replace(/\|/g, "/")} |`
      )
    }
  }
  lines.push("")
  return lines.join("\n")
}

function writeReport(report: Report): Report {
  const dir = path.resolve(process.cwd(), "docs/audits")
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const base = path.join(dir, `${stamp}-ingredient-price-conversions`)
  const jsonPath = `${base}.json`
  const mdPath = `${base}.md`
  report.reportFiles = { json: jsonPath, markdown: mdPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  fs.writeFileSync(mdPath, renderMarkdown(report))
  return report
}

function reviewKey(item: ReviewItem): string {
  return [
    item.kind,
    item.canonicalIngredientId,
    item.sku ?? "-",
    item.recipeUnit ?? "-",
    item.reason,
  ].join("::")
}

function dedupeReviewItems(items: ReviewItem[], actions: ReportAction[]): ReviewItem[] {
  const actionLineIds = new Set(actions.map((a) => a.lineItemId).filter(Boolean))
  const actionCanonicalSku = new Set(
    actions.map((a) => `${a.canonicalIngredientId}::${a.sku ?? "-"}`)
  )
  const seen = new Set<string>()
  const out: ReviewItem[] = []
  for (const item of items) {
    if (item.lineItemId && actionLineIds.has(item.lineItemId)) continue
    if (
      item.kind === "manual_review_required" &&
      actionCanonicalSku.has(`${item.canonicalIngredientId}::${item.sku ?? "-"}`)
    ) {
      continue
    }
    const key = reviewKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

async function main(): Promise<void> {
  const cli = parseArgs()
  if (cli.selfTest) {
    await runSelfTest()
    return
  }

  const { prisma } = await import("../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")
  const { canonicalizeUnit } = await import("../src/lib/unit-conversion")
  const { recomputeCanonicalCost } = await import("../src/lib/ingredient-cost")
  const { normalizeVendorName } = await import("../src/lib/vendor-normalize")

  const lineWhere = {
    canonicalIngredientId: { not: null },
    invoice: cli.accountId ? { accountId: cli.accountId } : {},
  }

  const lines = (await prisma.invoiceLineItem.findMany({
    where: lineWhere,
    orderBy: [{ invoice: { invoiceDate: "desc" } }, { lineNumber: "asc" }],
    select: {
      id: true,
      invoiceId: true,
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
      canonicalIngredient: {
        select: {
          id: true,
          ownerId: true,
          accountId: true,
          name: true,
          recipeUnit: true,
          costPerRecipeUnit: true,
          costLocked: true,
          _count: { select: { recipeIngredients: true } },
        },
      },
      invoice: {
        select: {
          id: true,
          ownerId: true,
          accountId: true,
          vendorName: true,
          invoiceNumber: true,
          invoiceDate: true,
          isReturn: true,
        },
      },
    },
  })) as InvoiceLine[]

  const skuMatches = (await prisma.ingredientSkuMatch.findMany({
    where: cli.accountId ? { accountId: cli.accountId } : {},
    select: {
      id: true,
      ownerId: true,
      accountId: true,
      vendorName: true,
      sku: true,
      canonicalIngredientId: true,
      conversionFactor: true,
      fromUnit: true,
      toUnit: true,
    },
  })) as ExistingSkuMatch[]

  const existingMatchByKey = new Map<string, ExistingSkuMatch>()
  for (const m of skuMatches) existingMatchByKey.set(matchKey(m.accountId, m.vendorName, m.sku), m)

  const getExistingConversion = (line: InvoiceLine): ExistingSkuMatch | undefined => {
    if (!line.sku || !line.canonicalIngredient) return undefined
    const vendor = normalizedVendor(line.invoice.vendorName, normalizeVendorName)
    const match = existingMatchByKey.get(matchKey(line.invoice.accountId, vendor, line.sku))
    if (match?.canonicalIngredientId === line.canonicalIngredient.id) return match
    return match
  }

  const derive = (line: InvoiceLine, conv?: ConversionPatch): number | null => {
    const recipeUnit = line.canonicalIngredient?.recipeUnit
    if (!recipeUnit) return null
    return deriveCostFromLineItem(
      line,
      recipeUnit,
      conv
        ? { conversionFactor: conv.conversionFactor, fromUnit: conv.fromUnit, toUnit: conv.toUnit }
        : undefined
    )
  }

  const profiles = new Map<string, Profile>()
  for (const line of lines) {
    const c = line.canonicalIngredient
    const key = groupKey(line, normalizeVendorName)
    if (!c || !key || !c.recipeUnit || c.recipeUnit.toLowerCase() !== "each") continue
    if (!PACKAGING_NAME.test(`${c.name} ${line.productName}`)) continue
    const conv = getExistingConversion(line)
    const cost = derive(line, conv)
    if (!isSaneEachCost(cost)) continue
    const baseUnit = line.unitSize && line.unitSize > 0 ? line.unitSizeUom : line.unit
    if (canonicalizeUnit(baseUnit) !== "each") continue

    const patch = {
      unit: line.unit,
      packSize: line.packSize,
      unitSize: line.unitSize,
      unitSizeUom: line.unitSizeUom,
    }
    const pKey = `${key}::${profileKey(patch)}`
    const existing = profiles.get(pKey)
    if (existing) {
      existing.count++
    } else {
      profiles.set(pKey, {
        ...patch,
        key,
        sampleLineId: line.id,
        count: 1,
        sampleCost: cost!,
      })
    }
  }

  const bestProfileByGroup = new Map<string, Profile>()
  for (const profile of profiles.values()) {
    const existing = bestProfileByGroup.get(profile.key)
    if (!existing || profile.count > existing.count) bestProfileByGroup.set(profile.key, profile)
  }

  const actions: ReportAction[] = []
  const review: ReviewItem[] = []
  const conversionActions = new Map<string, ReportAction>()
  const linePatchActions = new Map<string, ReportAction[]>()
  const touchedCanonicals = new Set<string>()
  const seenMissingUnitCanonicals = new Set<string>()
  const seenManualReviewLines = new Set<string>()

  function addLinePatch(line: InvoiceLine, action: ReportAction): void {
    actions.push(action)
    const existing = linePatchActions.get(line.id) ?? []
    existing.push(action)
    linePatchActions.set(line.id, existing)
    touchedCanonicals.add(action.canonicalIngredientId)
  }

  function addReview(line: InvoiceLine, item: ReviewItem): void {
    const key = `${item.kind}::${line.id}::${item.canonicalIngredientId}`
    if (seenManualReviewLines.has(key)) return
    seenManualReviewLines.add(key)
    review.push(item)
  }

  for (const line of lines) {
    const c = line.canonicalIngredient
    if (!c) continue

    const inScope = isRecipeScope(line)
    const conv = getExistingConversion(line)
    const beforeCost = derive(line, conv)
    const common = {
      lineItemId: line.id,
      canonicalIngredientId: c.id,
      canonicalName: c.name,
      vendorName: normalizedVendor(line.invoice.vendorName, normalizeVendorName),
      sku: line.sku,
      productName: line.productName,
      invoiceId: line.invoice.id,
      invoiceNumber: line.invoice.invoiceNumber,
      invoiceDate: isoDate(line.invoice.invoiceDate),
      beforeCost,
      recipeUnit: c.recipeUnit,
    }

    if (!inScope) {
      if (!c.recipeUnit && !seenMissingUnitCanonicals.has(c.id)) {
        seenMissingUnitCanonicals.add(c.id)
        review.push({
          kind: "excluded_non_recipe_scope",
          ...common,
          reason: "Matched line is outside recipe/per-order packaging scope.",
          recipeUses: c._count.recipeIngredients,
        })
      }
      continue
    }

    if (!c.recipeUnit) {
      if (!seenMissingUnitCanonicals.has(c.id)) {
        seenMissingUnitCanonicals.add(c.id)
        review.push({
          kind: "missing_recipe_unit",
          ...common,
          reason: "Canonical is recipe-scope but has no recipeUnit; no automatic unit can be inferred safely.",
          recipeUses: c._count.recipeIngredients,
        })
      }
      continue
    }

    if (
      !line.invoice.isReturn &&
      line.extendedPrice === 0 &&
      Number.isFinite(line.quantity) &&
      Number.isFinite(line.unitPrice) &&
      line.quantity > 0 &&
      line.unitPrice > 0
    ) {
      const expected = roundMoney(line.quantity * line.unitPrice)
      const patched = lineWithPatch(line, { extendedPrice: expected })
      const afterCost = derive(patched, conv)
      addLinePatch(line, {
        kind: "zero_extended_price",
        status: cli.apply ? "applied" : "would_apply",
        ...common,
        reason: "Non-return invoice line has extendedPrice=0 and quantity * unitPrice is unambiguous.",
        basis: `${line.quantity} * ${line.unitPrice} = ${expected}`,
        afterCost,
        patch: { extendedPrice: expected },
      })
    }

    const knownConversion = findKnownConversion(line)
    if (knownConversion && line.sku) {
      const patch = {
        conversionFactor: knownConversion.conversionFactor,
        fromUnit: knownConversion.fromUnit,
        toUnit: knownConversion.toUnit,
      }
      const afterCost = derive(line, patch)
      const sane = isSaneEachCost(afterCost, knownConversion.minCost, knownConversion.maxCost)
      const key = matchKey(line.invoice.accountId, common.vendorName, line.sku)
      if (sane && conversionChanged(existingMatchByKey.get(key), patch) && !conversionActions.has(key)) {
        const action: ReportAction = {
          kind: "known_explicit_yield",
          status: cli.apply ? "applied" : "would_apply",
          ...common,
          reason: "Known SKU yield bridges invoice base unit to recipe each.",
          basis: knownConversion.basis,
          afterCost,
          patch,
        }
        actions.push(action)
        conversionActions.set(key, action)
        touchedCanonicals.add(c.id)
      }
    }

    const knownPack = findKnownPackFix(line)
    if (knownPack) {
      const patched = lineWithPatch(line, knownPack.patch)
      const afterCost = derive(patched, conv)
      if (
        !isSameLinePatch(line, knownPack.patch) &&
        isSaneEachCost(afterCost, knownPack.minCost, knownPack.maxCost)
      ) {
        addLinePatch(line, {
          kind: "known_pack_extraction",
          status: cli.apply ? "applied" : "would_apply",
          ...common,
          reason: "Known case count fixes pack extraction from package volume to per-each count.",
          basis: knownPack.basis,
          afterCost,
          patch: knownPack.patch,
        })
      }
    }

    const profileGroupKey = groupKey(line, normalizeVendorName)
    const profile = profileGroupKey ? bestProfileByGroup.get(profileGroupKey) : null
    if (
      profile &&
      beforeCost == null &&
      c.recipeUnit.toLowerCase() === "each" &&
      PACKAGING_NAME.test(`${c.name} ${line.productName}`)
    ) {
      const patch = {
        unit: profile.unit,
        packSize: profile.packSize,
        unitSize: profile.unitSize,
        unitSizeUom: profile.unitSizeUom,
      }
      const patched = lineWithPatch(line, patch)
      const afterCost = derive(patched, conv)
      if (!isSameLinePatch(line, patch) && isSaneEachCost(afterCost)) {
        addLinePatch(line, {
          kind: "same_sku_pack_profile",
          status: cli.apply ? "applied" : "would_apply",
          ...common,
          reason: "Same vendor/SKU has a prior working per-each packaging profile.",
          basis: `Profile from line ${profile.sampleLineId}; ${profile.count} matching working line(s).`,
          afterCost,
          patch,
        })
      }
    }

    const hasFix = actions.some((a) => a.lineItemId === line.id || (line.sku && a.sku === line.sku && a.canonicalIngredientId === c.id))
    if (beforeCost == null && !hasFix) {
      addReview(line, {
        kind: "manual_review_required",
        ...common,
        reason: "Recipe-scope matched line still cannot derive a normalized price after safe fix checks.",
        recipeUses: c._count.recipeIngredients,
      })
    }
  }

  if (cli.apply) {
    for (const [lineId, lineActions] of linePatchActions) {
      const patch = Object.assign({}, ...lineActions.map((a) => a.patch)) as LinePatch
      await prisma.invoiceLineItem.update({ where: { id: lineId }, data: patch })
    }

    for (const [key, action] of conversionActions) {
      const [accountId, vendorName, sku] = key.split("::")
      const patch = action.patch as ConversionPatch
      const canonical = lines.find(
        (line) =>
          line.invoice.accountId === accountId &&
          normalizedVendor(line.invoice.vendorName, normalizeVendorName) === vendorName &&
          line.sku === sku &&
          line.canonicalIngredientId === action.canonicalIngredientId
      )?.canonicalIngredient
      if (!canonical) continue

      await prisma.ingredientSkuMatch.upsert({
        where: { accountId_vendorName_sku: { accountId, vendorName, sku } },
        update: {
          ownerId: canonical.ownerId,
          canonicalIngredientId: canonical.id,
          conversionFactor: patch.conversionFactor,
          fromUnit: patch.fromUnit,
          toUnit: patch.toUnit,
          confirmedBy: canonical.ownerId,
          confirmedAt: new Date(),
        },
        create: {
          ownerId: canonical.ownerId,
          accountId,
          vendorName,
          sku,
          canonicalIngredientId: canonical.id,
          conversionFactor: patch.conversionFactor,
          fromUnit: patch.fromUnit,
          toUnit: patch.toUnit,
          confirmedBy: canonical.ownerId,
        },
      })
    }

    for (const canonicalId of touchedCanonicals) {
      const result = await recomputeCanonicalCost(canonicalId)
      for (const action of actions) {
        if (action.canonicalIngredientId === canonicalId) action.recompute = result
      }
    }
  }

  const reviewForReport = dedupeReviewItems(review, actions)
  const actionCanonicals = new Set(actions.map((a) => a.canonicalIngredientId))
  const reviewCanonicals = new Set(reviewForReport.map((r) => r.canonicalIngredientId))
  const affectedCanonicals = new Set([...actionCanonicals, ...reviewCanonicals])

  const counts = {
    matchedLinesScanned: lines.length,
    safeFixes: actions.length,
    actionCanonicals: actionCanonicals.size,
    reviewCanonicals: reviewCanonicals.size,
    affectedCanonicals: affectedCanonicals.size,
    knownExplicitYield: actions.filter((a) => a.kind === "known_explicit_yield").length,
    knownPackExtraction: actions.filter((a) => a.kind === "known_pack_extraction").length,
    sameSkuPackProfile: actions.filter((a) => a.kind === "same_sku_pack_profile").length,
    zeroExtendedPrice: actions.filter((a) => a.kind === "zero_extended_price").length,
    missingRecipeUnit: reviewForReport.filter((r) => r.kind === "missing_recipe_unit").length,
    manualReviewRequired: reviewForReport.filter((r) => r.kind === "manual_review_required").length,
    excludedNonRecipeScope: reviewForReport.filter((r) => r.kind === "excluded_non_recipe_scope").length,
  }

  const report = writeReport({
    generatedAt: new Date().toISOString(),
    mode: cli.apply ? "apply" : "dry-run",
    accountId: cli.accountId ?? null,
    counts,
    actions,
    review: reviewForReport,
  })

  console.log(`\n${cli.apply ? "APPLY" : "DRY-RUN"} ingredient price conversion fixer`)
  console.log(`Matched lines scanned: ${counts.matchedLinesScanned}`)
  console.log(`Safe fixes ${cli.apply ? "applied" : "available"}: ${counts.safeFixes}`)
  console.log(`Review items: ${report.review.length}`)
  console.log(`Report JSON: ${report.reportFiles?.json}`)
  console.log(`Report Markdown: ${report.reportFiles?.markdown}`)
  if (!cli.apply) console.log("Dry-run only. Re-run with --apply to write deterministic fixes.")

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
