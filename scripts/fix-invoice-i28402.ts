// scripts/fix-invoice-i28402.ts
//
// One-off correction for Individual FoodService invoice I28402-00 (2026-07-27),
// which gemini-2.5-flash extracted with shifted SKU columns and corrupted
// quantities. Verified line-by-line against the archived PDF in R2
// (tmp/invoice-12840200.pdf). Read-only audit that found this:
// tmp/audit-soda-mappings.ts / tmp/soda-audit.json.
//
// Corrections applied (all guarded by expected-current-value checks):
//   header  invoiceNumber "12840200" → "I28402-00", subtotal 1182.80 → 1152.80
//   line 1  Coke:   qty 1 → 3, unit $37.31 → $43.77, ext $37.31 → $131.31
//   line 2  Sprite: sku G7234 → G7244, remap Coke → Sprite canonical
//   line 3  Fanta:  sku G7244 → G7246, remap Sprite → Fanta canonical
//   line 4  Tray paper: price 33.76 → 34.18 (swapped with line 5)
//   line 5  Dish soap:  price 34.18 → 33.76
//   line 6  Ketchup packets: was hallucinated as "COFFEE FILTERS" sku G21025 at
//           half price; restore sku G1025, real name, $25.99 × 2 = $51.98,
//           pack 1000×9GR, map to the learned ketchup canonical
//   line 10 Lemonade syrup: sku NFBGMNLEM → NFBGMINLEM (digit-dropped)
//
// Then re-derives costPerRecipeUnit for the four affected canonicals via the
// production recompute path (spike guard included).
//
// Usage:
//   npx tsx scripts/fix-invoice-i28402.ts            # dry run (no DB writes)
//   npx tsx scripts/fix-invoice-i28402.ts --apply    # apply
//
// Note: Beyond ordinary safety, guarding on current values makes this script
// idempotent — a second run finds nothing matching and exits.

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

const APPLY = process.argv.includes("--apply")

const CANONICAL = {
  coke: "cmo58ubc000103nu9yxeujip5", // soda coke mexican glass
  sprite: "cmo58ul6500543nu9i56jxaiz", // soda sprite mexican glass crv inc
  fanta: "cmo58uebv002e3nu9qynpmra7", // soda orange fanta mexican glass
  ketchup: "cmo58ueww002o3nu91r8ou3nb", // ketchup packets foil
} as const

type LineFix = {
  lineNumber: number
  expect: Partial<{
    sku: string | null
    productName: string
    quantity: number
    unitPrice: number
    extendedPrice: number
    canonicalIngredientId: string | null
  }>
  set: Record<string, unknown>
}

const LINE_FIXES: LineFix[] = [
  {
    lineNumber: 1,
    expect: { sku: "G7234", quantity: 1, unitPrice: 37.31, extendedPrice: 37.31 },
    set: {
      productName: "SODA COKE MEXICAN GLASS",
      description: "SODA COKE MEXICAN GLASS G7234",
      quantity: 3,
      unitPrice: 43.77,
      extendedPrice: 131.31,
    },
  },
  {
    lineNumber: 2,
    expect: { sku: "G7234", canonicalIngredientId: CANONICAL.coke },
    set: {
      sku: "G7244",
      productName: "SODA SPRITE MEXICAN GLASS CRV INC",
      description: "SODA SPRITE MEXICAN GLASS CRV INC G7244",
      canonicalIngredientId: CANONICAL.sprite,
      matchSource: "manual",
      matchedAt: new Date(),
    },
  },
  {
    lineNumber: 3,
    expect: { sku: "G7244", canonicalIngredientId: CANONICAL.sprite },
    set: {
      sku: "G7246",
      productName: "SODA ORANGE FANTA MEXICAN GLASS",
      description: "SODA ORANGE FANTA MEXICAN GLASS G7246",
      canonicalIngredientId: CANONICAL.fanta,
      matchSource: "manual",
      matchedAt: new Date(),
    },
  },
  {
    lineNumber: 4,
    expect: { sku: "SQP2650", unitPrice: 33.76, extendedPrice: 33.76 },
    set: {
      productName: "TRAY FOOD PPR #50 1/2LB WHT/RED CHECK",
      description: "TRAY FOOD PPR #50 1/2LB WHT/RED CHECK SQP2650",
      unitPrice: 34.18,
      extendedPrice: 34.18,
    },
  },
  {
    lineNumber: 5,
    expect: { sku: "210529", unitPrice: 34.18, extendedPrice: 34.18 },
    set: {
      productName: "SOAP DISH LIQUID PREMIUM",
      description: "SOAP DISH LIQUID PREMIUM 210529",
      unitPrice: 33.76,
      extendedPrice: 33.76,
    },
  },
  {
    lineNumber: 6,
    expect: { sku: "G21025", unitPrice: 12.995, extendedPrice: 25.99, canonicalIngredientId: null },
    set: {
      sku: "G1025",
      productName: "KETCHUP PACKETS FOIL",
      description: "KETCHUP PACKETS FOIL G1025",
      category: "Condiments",
      unitPrice: 25.99,
      extendedPrice: 51.98,
      packSize: 1000,
      unitSize: 9,
      unitSizeUom: "GR",
      canonicalIngredientId: CANONICAL.ketchup,
      matchSource: "manual",
      matchedAt: new Date(),
    },
  },
  {
    lineNumber: 10,
    expect: { sku: "NFBGMNLEM" },
    set: {
      sku: "NFBGMINLEM",
      description: "SYRUP LEMONADE NFBGMINLEM",
    },
  },
]

async function main() {
  const mode = APPLY ? "APPLY" : "DRY-RUN"
  console.log(`\n${mode}: fix Individual FoodService invoice I28402-00\n`)

  const { prisma } = await import("../src/lib/prisma")

  const invoice = await prisma.invoice.findFirst({
    where: { vendorName: "Individual FoodService", invoiceNumber: "12840200" },
    include: { lineItems: { orderBy: { lineNumber: "asc" } } },
  })
  if (!invoice) {
    console.log("Invoice with number '12840200' not found — already fixed? Nothing to do.")
    return
  }
  console.log(`invoice ${invoice.id}  #${invoice.invoiceNumber}  subtotal=$${invoice.subtotal}  total=$${invoice.totalAmount}`)

  // ── Header ──
  const headerOk = invoice.subtotal === 1182.8 && invoice.totalAmount === 1192.75
  if (!headerOk) {
    throw new Error(`Header state unexpected (subtotal=${invoice.subtotal}, total=${invoice.totalAmount}) — aborting`)
  }
  console.log(`  header: invoiceNumber "12840200" → "I28402-00", subtotal 1182.80 → 1152.80`)

  // ── Lines: verify every expected value before touching anything ──
  const planned: Array<{ id: string; lineNumber: number; set: Record<string, unknown> }> = []
  for (const fix of LINE_FIXES) {
    const line = invoice.lineItems.find((l) => l.lineNumber === fix.lineNumber)
    if (!line) throw new Error(`Line ${fix.lineNumber} not found — aborting`)
    for (const [k, v] of Object.entries(fix.expect)) {
      const actual = (line as unknown as Record<string, unknown>)[k]
      if (actual !== v) {
        throw new Error(
          `Line ${fix.lineNumber}: expected ${k}=${JSON.stringify(v)} but found ${JSON.stringify(actual)} — aborting (state drifted?)`
        )
      }
    }
    planned.push({ id: line.id, lineNumber: fix.lineNumber, set: fix.set })
    console.log(`  line ${String(fix.lineNumber).padStart(2)}: "${line.productName}" →`, JSON.stringify(fix.set))
  }

  // Sanity: corrected lines must reconcile with the PDF's printed totals.
  const correctedSum = invoice.lineItems.reduce((sum, l) => {
    const fix = LINE_FIXES.find((f) => f.lineNumber === l.lineNumber)
    const ext = (fix?.set.extendedPrice as number | undefined) ?? l.extendedPrice
    return sum + ext
  }, 0)
  // 1152.80 merchandise + 7.75 fuel-charge line = totalAmount − tax
  const expected = 1192.75 - 32.2
  if (Math.abs(correctedSum - expected) > 0.01) {
    throw new Error(`Corrected line sum $${correctedSum.toFixed(2)} ≠ $${expected.toFixed(2)} — aborting`)
  }
  console.log(`  ✓ corrected lines sum to $${correctedSum.toFixed(2)} = total $1192.75 − tax $32.20\n`)

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to write.")
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { invoiceNumber: "I28402-00", subtotal: 1152.8 },
    })
    for (const p of planned) {
      await tx.invoiceLineItem.update({ where: { id: p.id }, data: p.set })
    }
  })
  console.log("Invoice + 7 lines updated.\n")

  // ── Re-derive costs through the production path (includes spike guard) ──
  const { recomputeCanonicalCost } = await import("../src/lib/ingredient-cost")
  for (const [label, id] of Object.entries(CANONICAL)) {
    const result = await recomputeCanonicalCost(id)
    if (result.status === "updated") {
      console.log(
        `  cost ${label}: $${result.before?.toFixed(6) ?? "∅"} → $${result.after.toFixed(6)} per ${result.unit}`
      )
    } else {
      console.log(`  cost ${label}: unchanged (${result.reason})`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
