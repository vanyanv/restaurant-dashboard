// scripts/compare-vitco-vs-current.ts
//
// Read-only: compare the two Vitco Foodservice invoices dated 04/22/2026
// (Invoice Chris N Eddy.pdf + Invoice Chris N Eddy IFS.pdf from Downloads)
// against the current per-ingredient costs in the dashboard.
//
// Matches each Vitco line to a known CanonicalIngredient by explicit name,
// normalizes both prices to the canonical's recipeUnit using the same
// deriveCostFromLineItem helper the invoice sync pipeline uses, then prints
// a line-by-line comparison + bottom-line verdict.
//
// Run: npx tsx scripts/compare-vitco-vs-current.ts

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

/* ------------------------------------------------------------------ */
/* Vitco line items — transcribed directly from the two PDFs.          */
/* Freight is excluded (not an ingredient cost).                       */
/* `canonicalName` is the name field in CanonicalIngredient we expect   */
/* to match. Set to null when no reasonable analog exists in our DB.    */
/* ------------------------------------------------------------------ */

type VitcoLine = {
  invoice: string
  sku: string
  product: string
  // Case math: packSize × unitSize unitSizeUom = total base qty per case
  packSize: number
  unitSize: number
  unitSizeUom: string // e.g. "LB", "GAL", "ML", "CT"
  unit: string // order unit, usually "CS"
  casePrice: number // $ per single case (unit price on invoice line)
  casesOrdered: number // informational only — how many cases were on this Vitco invoice
  canonicalName: string | null
  note?: string
}

const VITCO_LINES: VitcoLine[] = [
  // ── Invoice 231108-00 (food, $1,675.29) ────────────────────────────
  { invoice: "231108-00", sku: "7135",  product: "SOFT SERVE MIX 5% VANILLA ROCKVIEW RTU",   packSize: 6,  unitSize: 0.5,   unitSizeUom: "gal",  unit: "CS", casePrice: 31.95,  casesOrdered: 6,  canonicalName: "whole class ice cream mix soft serve vanilla 5%" },
  { invoice: "231108-00", sku: "12396", product: "BUTTER PRINT UNSALTED 30/1#",              packSize: 30, unitSize: 1,     unitSizeUom: "lb",   unit: "CS", casePrice: 69.75,  casesOrdered: 1,  canonicalName: "whole frozen butter solid usda aa unsalted" },
  { invoice: "231108-00", sku: "14102", product: "FRIES 1/4\" SHOESTRING LAMB WESTON STEALTH", packSize: 6,  unitSize: 4.5,   unitSizeUom: "lb",   unit: "CS", casePrice: 36.57,  casesOrdered: 18, canonicalName: "lamb potato fry ss 1/4 stealth" },
  { invoice: "231108-00", sku: "11575", product: "BUNS POTATO SANWCH 3.5\" ROLL 72CT MARTINS", packSize: 9,  unitSize: 8,     unitSizeUom: "each", unit: "CS", casePrice: 23.42,  casesOrdered: 20, canonicalName: "martins bread potato roll sandwich 3.5 inch" },
  { invoice: "231108-00", sku: "7354",  product: "OIL LIQUID FRY CREAMY ZTF VERSA",          packSize: 1,  unitSize: 35,    unitSizeUom: "lb",   unit: "CS", casePrice: 37.10,  casesOrdered: 2,  canonicalName: "sysco reliable shortening fry liquid clear ztf" },
  { invoice: "231108-00", sku: "14034", product: "GLOVES NITRILE BLK LRG P/F VITCO",         packSize: 10, unitSize: 100,   unitSizeUom: "each", unit: "CS", casePrice: 33.60,  casesOrdered: 1,  canonicalName: "sysco classic gloves nitrile foodservice powder free black",
    note: "Existing canonical cost $0.0038/each appears 10× lower than market — likely a DB data-quality issue, treat the delta below with skepticism" },
  { invoice: "231108-00", sku: "8151",  product: "LETTUCE BUTTER LIVING 12CT BOSTON CLMSHL", packSize: 1,  unitSize: 12,    unitSizeUom: "each", unit: "CS", casePrice: 26.75,  casesOrdered: 2,  canonicalName: "packer lettuce boston hydroponic",
    note: "Existing $0.15/each manual price looks low for Boston/butter lettuce — verify baseline before acting" },
  { invoice: "231108-00", sku: "8800",  product: "ONION SWEET YELLOW JUMBO 40# PACKER",      packSize: 1,  unitSize: 40,    unitSizeUom: "lb",   unit: "CS", casePrice: 28.40,  casesOrdered: 4,  canonicalName: "packer onion sweet fresh" },

  // ── Invoice 231110-00 (supplies/bev, $567.16) ──────────────────────
  { invoice: "231110-00", sku: "4642",  product: "SODA SPRITE MEXICAN BOTTLES 24/355ML",     packSize: 24, unitSize: 355,   unitSizeUom: "ml",   unit: "CS", casePrice: 43.01,  casesOrdered: 1,  canonicalName: "soda sprite mexican glass crv inc",
    note: "Vitco bottle is 355 ml; current IFS SKU is 500 ml — same $43.01/cs but less soda per case" },
  { invoice: "231110-00", sku: "2822",  product: "SODA HI C FRUIT PUNCH BIB 1/5 GAL",         packSize: 1,  unitSize: 5,     unitSizeUom: "gal",  unit: "CS", casePrice: 121.22, casesOrdered: 1,  canonicalName: "syrup hi-c fruit punch flashin" },
  { invoice: "231110-00", sku: "2845",  product: "SODA SPRITE BIB 1/5 GAL",                   packSize: 1,  unitSize: 5,     unitSizeUom: "gal",  unit: "CS", casePrice: 121.22, casesOrdered: 1,  canonicalName: "syrup sprite" },
  { invoice: "231110-00", sku: "3858",  product: "SOAP HAND PINK LIQUID VITCO",               packSize: 4,  unitSize: 1,     unitSizeUom: "gal",  unit: "CS", casePrice: 27.29,  casesOrdered: 1,  canonicalName: null,
    note: "No hand-soap canonical in DB. 'soap dish liquid premium' is a different product (dish vs hand) — skipping" },
  { invoice: "231110-00", sku: "13995", product: "CUP SOUFFLE 2 OZ CLR PP VITCO",             packSize: 10, unitSize: 250,   unitSizeUom: "each", unit: "CS", casePrice: 23.92,  casesOrdered: 1,  canonicalName: "cup portion plastic 2 oz clear" },
  { invoice: "231110-00", sku: "14003", product: "LID SOUFFLE 1.5-2 OZ CLR VITCO",            packSize: 20, unitSize: 125,   unitSizeUom: "each", unit: "CS", casePrice: 20.80,  casesOrdered: 1,  canonicalName: "lid portion plastic 1.5, 2, 2.5 oz" },
  { invoice: "231110-00", sku: "4472",  product: "TISSUE BATH 2-PLY US 96/500 SHEETS",        packSize: 96, unitSize: 500,   unitSizeUom: "each", unit: "CS", casePrice: 46.59,  casesOrdered: 1,  canonicalName: "embossed bath tissue 2-ply recycled individually wrapped",
    note: "Canonical recipeUnit is 'cs' (not a real unit) — skipping" },
  { invoice: "231110-00", sku: "3875",  product: "TOWEL MULTIFOLD KRAFT 9.5X9.15 US",         packSize: 16, unitSize: 250,   unitSizeUom: "each", unit: "CS", casePrice: 22.62,  casesOrdered: 1,  canonicalName: "towel multifold kraft 1-ply",
    note: "Existing is 1-ply; Vitco is unspecified ply (likely same kraft grade)" },
  { invoice: "231110-00", sku: "13178", product: "NAP INTERFOLD WHT 2-PLY 6.5X8.86 OPTI-NAP", packSize: 24, unitSize: 250,   unitSizeUom: "each", unit: "CS", casePrice: 36.93,  casesOrdered: 1,  canonicalName: "napkin dispenser 2-ply 8.5 x 6.5 white" },
  { invoice: "231110-00", sku: "5781",  product: "MUSTARD PACKETS WOEBER 500/5.5G",            packSize: 500, unitSize: 5.5,  unitSizeUom: "g",    unit: "CS", casePrice: 18.52,  casesOrdered: 1,  canonicalName: "mustard packets 5.5 g" },
  { invoice: "231110-00", sku: "10569", product: "CONT MFPP 9X9 HNGD 1-COMP WHT VITCO",        packSize: 1,  unitSize: 150,   unitSizeUom: "each", unit: "CS", casePrice: 28.04,  casesOrdered: 1,  canonicalName: "container foam 1-compartment bagged",
    note: "Existing canonical is FOAM 9×9; Vitco is MFPP (polypropylene) 9×9 — different material" },
  { invoice: "231110-00", sku: "2022",  product: "KETCHUP TABLE CANS MERIT SUNSOURCE 6/#10",   packSize: 6,  unitSize: 6.875, unitSizeUom: "lb",   unit: "CS", casePrice: 37.39,  casesOrdered: 1,  canonicalName: "ketchup heinz 33% fancy",
    note: "Vitco is Merit brand, existing is Heinz; #10 can assumed ~110 oz fill (~6.875 lb)" },
]

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")

  console.log("\n═════════════════════════════════════════════════════════════════════")
  console.log("  Vitco Foodservice  vs  Current Vendor Prices")
  console.log("  Source: two Vitco invoices placed 04/22/2026")
  console.log("═════════════════════════════════════════════════════════════════════\n")

  type Row = {
    vitco: VitcoLine
    canonical: {
      id: string
      name: string
      recipeUnit: string | null
      costPerRecipeUnit: number | null
      costSource: string | null
    } | null
    currentLine: {
      vendor: string
      date: Date
      unitPrice: number
      derived: number | null
    } | null
    vitcoDerived: number | null
    deltaPct: number | null
  }

  const rows: Row[] = []

  for (const v of VITCO_LINES) {
    if (!v.canonicalName) {
      rows.push({ vitco: v, canonical: null, currentLine: null, vitcoDerived: null, deltaPct: null })
      continue
    }

    const canonical = await prisma.canonicalIngredient.findFirst({
      where: { name: v.canonicalName },
      select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, costSource: true },
    })

    if (!canonical) {
      rows.push({ vitco: v, canonical: null, currentLine: null, vitcoDerived: null, deltaPct: null })
      continue
    }

    // Derive the Vitco cost-per-recipe-unit. Quantity=1 so we're comparing per case.
    const vitcoDerived = canonical.recipeUnit
      ? deriveCostFromLineItem(
          {
            quantity: 1,
            unit: v.unit,
            packSize: v.packSize,
            unitSize: v.unitSize,
            unitSizeUom: v.unitSizeUom,
            unitPrice: v.extendedPrice,
            extendedPrice: v.extendedPrice,
          },
          canonical.recipeUnit
        )
      : null

    // Most recent non-Vitco matched line for context (vendor + date).
    const currentLine = await prisma.invoiceLineItem.findFirst({
      where: {
        canonicalIngredientId: canonical.id,
        quantity: { gt: 0 },
        invoice: { vendorName: { not: { contains: "Vitco" } } },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    })

    const currentDerived =
      currentLine && canonical.recipeUnit
        ? deriveCostFromLineItem(
            {
              quantity: currentLine.quantity,
              unit: currentLine.unit,
              packSize: currentLine.packSize,
              unitSize: currentLine.unitSize,
              unitSizeUom: currentLine.unitSizeUom,
              unitPrice: currentLine.unitPrice,
              extendedPrice: currentLine.extendedPrice,
            },
            canonical.recipeUnit
          )
        : null

    // Prefer the recent-line derivation; fall back to canonical.costPerRecipeUnit.
    const currentForDelta = currentDerived ?? canonical.costPerRecipeUnit

    const deltaPct =
      vitcoDerived != null && currentForDelta != null && currentForDelta > 0
        ? ((vitcoDerived - currentForDelta) / currentForDelta) * 100
        : null

    rows.push({
      vitco: v,
      canonical,
      currentLine: currentLine
        ? {
            vendor: currentLine.invoice.vendorName,
            date: currentLine.invoice.invoiceDate,
            unitPrice: currentLine.unitPrice,
            derived: currentDerived,
          }
        : null,
      vitcoDerived,
      deltaPct,
    })
  }

  // ── Print matched table ─────────────────────────────────────────
  const matched = rows.filter((r) => r.canonical && r.vitcoDerived != null && r.deltaPct != null)
  const skipped = rows.filter((r) => !r.canonical || r.vitcoDerived == null || r.deltaPct == null)

  console.log("── MATCHED / COMPARABLE ───────────────────────────────────────────────")
  console.log(
    pad("Product (Vitco SKU)", 44) +
      pad("Unit", 6) +
      pad("Current $/u", 14) +
      pad("Vitco $/u", 12) +
      pad("Δ%", 9) +
      "Cheaper?  Vendor (date)"
  )
  console.log("─".repeat(120))
  for (const r of matched) {
    const unit = r.canonical!.recipeUnit ?? "?"
    const curr = r.currentLine?.derived ?? r.canonical!.costPerRecipeUnit
    const vendorNote = r.currentLine
      ? `${r.currentLine.vendor} (${r.currentLine.date.toISOString().slice(0, 10)})`
      : `(canonical stored: ${r.canonical!.costSource ?? "?"})`
    const cheaperFlag = r.deltaPct! < -1 ? "✓ YES   " : r.deltaPct! > 1 ? "✗ NO    " : "≈ TIED  "
    console.log(
      pad(`${r.vitco.product.slice(0, 38)} (${r.vitco.sku})`, 44) +
        pad(unit, 6) +
        pad(curr != null ? `$${curr.toFixed(4)}` : "—", 14) +
        pad(`$${r.vitcoDerived!.toFixed(4)}`, 12) +
        pad(signedPct(r.deltaPct!), 9) +
        cheaperFlag +
        vendorNote
    )
    if (r.vitco.note) console.log(`    ⚠ ${r.vitco.note}`)
  }

  // ── Print skipped ────────────────────────────────────────────────
  console.log("\n── SKIPPED (no comparable canonical) ──────────────────────────────────")
  if (skipped.length === 0) console.log("  (none)")
  for (const r of skipped) {
    const reason = !r.canonical
      ? r.vitco.canonicalName
        ? `canonical '${r.vitco.canonicalName}' not found in DB`
        : "user-flagged no-baseline"
      : r.vitcoDerived == null
        ? `could not derive Vitco $/${r.canonical!.recipeUnit ?? "?"} (unit bridge failed)`
        : "no current price stored"
    console.log(`  • ${r.vitco.product} (${r.vitco.sku})`)
    console.log(`      reason: ${reason}`)
    if (r.vitco.note) console.log(`      note:   ${r.vitco.note}`)
  }

  // ── Verdict ────────────────────────────────────────────────────
  const cheaper = matched.filter((r) => r.deltaPct! < -1)
  const moreExp = matched.filter((r) => r.deltaPct! > 1)
  const tied = matched.filter((r) => Math.abs(r.deltaPct!) <= 1)

  // Spend-weighted average delta across matched lines, weighted by Vitco extendedPrice.
  const totalSpend = matched.reduce((s, r) => s + r.vitco.extendedPrice, 0)
  const weightedDelta =
    totalSpend > 0
      ? matched.reduce((s, r) => s + r.deltaPct! * r.vitco.extendedPrice, 0) / totalSpend
      : 0

  // Absolute-dollar delta: (vitco − current) × qty_purchased_on_these_invoices.
  // For each matched line, qty = extendedPrice / unit-case-price.
  let dollarsSaved = 0
  for (const r of matched) {
    const curr = r.currentLine?.derived ?? r.canonical!.costPerRecipeUnit
    if (curr == null || r.vitcoDerived == null) continue
    // Total recipe-units actually purchased on the Vitco invoice for this line:
    const unitsBought = r.vitco.extendedPrice / r.vitcoDerived
    dollarsSaved += (curr - r.vitcoDerived) * unitsBought
  }

  console.log("\n── VERDICT ────────────────────────────────────────────────────────────")
  console.log(`  Matched lines:   ${matched.length}`)
  console.log(`    Cheaper:       ${cheaper.length}`)
  console.log(`    More expensive: ${moreExp.length}`)
  console.log(`    Tied (±1%):    ${tied.length}`)
  console.log(`  Skipped lines:   ${skipped.length}`)
  console.log("")
  console.log(
    `  Spend-weighted Δ (matched lines, weighted by Vitco $): ${signedPct(weightedDelta)}`
  )
  console.log(
    `  Estimated $ saved on these two invoices (matched only): ${
      dollarsSaved >= 0 ? "$" : "-$"
    }${Math.abs(dollarsSaved).toFixed(2)}`
  )
  console.log("")
  console.log("  Raw invoice totals (for reference):")
  console.log("    231108-00 (food):       $1,675.29")
  console.log("    231110-00 (supplies):     $567.16")
  console.log("    Combined Vitco spend:   $2,242.45")
  console.log("")
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + " "
  return s + " ".repeat(n - s.length)
}
function signedPct(n: number): string {
  const sign = n >= 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
