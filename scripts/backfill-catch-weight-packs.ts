// One-shot backfill: populate packSize / unitSize / unitSizeUom on existing
// catch-weight meat lines that were extracted before the
// `normalizeCatchWeightMeatLines` change that preserves pack fields.
//
// Source of truth, in preference order:
//   1. parsePerCaseWeights(description) — when 2+ comma-separated weights are
//      printed below the invoice line and their sum matches `quantity` within
//      LINE_MATH_TOLERANCE, we can populate fields exactly.
//   2. Otherwise: log the line to a "needs-review" list. We do NOT guess from
//      quantity / N here — historical data doesn't have the original carton
//      count column captured anywhere, so any inference would be unsound.
//
// Usage:
//   npx tsx scripts/backfill-catch-weight-packs.ts            # dry-run (default)
//   npx tsx scripts/backfill-catch-weight-packs.ts --apply    # actually mutate

import { loadEnvLocal } from "./audit/lib"

const APPLY = process.argv.includes("--apply")
const LINE_MATH_TOLERANCE = 0.02

const CATCH_WEIGHT_VENDOR_RE =
  /\b(premier\s+meats?|crystal\s+bay|ben\s+e\.?\s+keith)\b/i
const MEAT_LINE_RE =
  /\b(meat|beef|ground\s+beef|angus|chuck|brisket|ribeye|steak|sirloin|pork|bacon|ham|chicken|turkey|poultry|seafood|fish|salmon|tuna)\b/i

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")
  const { parsePerCaseWeights } = await import("@/lib/invoice-sanity")

  console.log(APPLY ? "Mode: --apply (will write changes)" : "Mode: dry-run (read-only)")
  console.log()

  // Candidate set: catch-weight signature missing — unit=LB, packSize null,
  // with a parent invoice. Filter further in JS using the vendor / category
  // / product-name gate.
  const candidates = await prisma.invoiceLineItem.findMany({
    where: { unit: "LB", packSize: null },
    select: {
      id: true,
      productName: true,
      description: true,
      category: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      extendedPrice: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      invoice: {
        select: { id: true, invoiceNumber: true, vendorName: true, invoiceDate: true },
      },
    },
  })

  let scanned = 0
  let skippedNotMeat = 0
  let needsReview = 0
  let wouldUpdate = 0
  let updated = 0

  const reviewExamples: Array<{
    invoice: string
    vendor: string
    qty: number
    why: string
  }> = []

  for (const li of candidates) {
    scanned++
    const vendor = li.invoice.vendorName ?? ""
    const category = li.category?.trim().toLowerCase() ?? ""
    const productText = `${li.productName} ${li.description ?? ""}`
    const isMeat =
      CATCH_WEIGHT_VENDOR_RE.test(vendor) ||
      category === "meat" ||
      category === "poultry" ||
      category === "seafood" ||
      MEAT_LINE_RE.test(productText)
    if (!isMeat) {
      skippedNotMeat++
      continue
    }

    const weights = parsePerCaseWeights(li.description)
    if (!weights) {
      needsReview++
      if (reviewExamples.length < 10) {
        reviewExamples.push({
          invoice: li.invoice.invoiceNumber,
          vendor,
          qty: li.quantity,
          why: "no per-case weight list in description",
        })
      }
      continue
    }

    const sum = weights.reduce((acc, v) => acc + v, 0)
    const drift = Math.abs(sum - li.quantity) / Math.abs(li.quantity || 1)
    if (drift > LINE_MATH_TOLERANCE) {
      needsReview++
      if (reviewExamples.length < 10) {
        reviewExamples.push({
          invoice: li.invoice.invoiceNumber,
          vendor,
          qty: li.quantity,
          why: `weight-sum drift ${(drift * 100).toFixed(1)}% (${sum.toFixed(2)} vs ${li.quantity}) — partial list?`,
        })
      }
      continue
    }

    const packSize = weights.length
    const unitSize = sum / weights.length
    wouldUpdate++
    console.log(
      `${APPLY ? "UPDATE" : "WOULD UPDATE"}  Invoice ${li.invoice.invoiceNumber} (${vendor}) qty=${li.quantity}LB → packSize=${packSize}, unitSize=${unitSize.toFixed(2)}LB`
    )

    if (APPLY) {
      await prisma.invoiceLineItem.update({
        where: { id: li.id },
        data: {
          packSize,
          unitSize: Math.round(unitSize * 1000) / 1000,
          unitSizeUom: "LB",
        },
      })
      updated++
    }
  }

  console.log()
  console.log("=== Summary ===")
  console.log(`  Scanned (unit=LB, packSize null):  ${scanned}`)
  console.log(`  Skipped (not catch-weight meat):   ${skippedNotMeat}`)
  console.log(`  Would update (weights matched):    ${wouldUpdate}`)
  console.log(`  Needs review (no/partial weights): ${needsReview}`)
  if (APPLY) console.log(`  Actually applied:                  ${updated}`)

  if (reviewExamples.length > 0) {
    console.log()
    console.log("=== First 10 needs-review lines ===")
    for (const r of reviewExamples) {
      console.log(`  Invoice ${r.invoice}  (${r.vendor})  qty=${r.qty}LB  — ${r.why}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
