// scripts/fix-flagged-ingredient-costs.ts
//
// Idempotent repair for the ingredient-cost anomalies surfaced in the
// 2026-05-02 COGS audit. Dry-run by default.
//
//   npx tsx scripts/fix-flagged-ingredient-costs.ts
//   npx tsx scripts/fix-flagged-ingredient-costs.ts --commit

import { loadEnvLocal, money } from "./audit/lib"

loadEnvLocal()

const COMMIT = process.argv.includes("--commit")

const SAUCE_LINE_ID = "cmo52brlt0025xju9q6eds5bq"
const BAG_LINE_ID = "cmo52dz8k003sxju92iqo4y98"
const LETTUCE_NAME = "packer lettuce boston hydroponic"
const LETTUCE_SKU = "2717106"
const LETTUCE_COST_PER_EACH = 26.89 / 112

type PrismaClient = typeof import("../src/lib/prisma").prisma

type LinePreview = {
  id: string
  sku: string | null
  productName: string
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  extendedPrice: number
  invoice: {
    invoiceNumber: string | null
    invoiceDate: Date | null
    vendorName: string
  }
  canonicalIngredient?: { name: string; recipeUnit: string | null } | null
}

function lineLabel(line: LinePreview): string {
  return [
    line.canonicalIngredient?.name ?? line.productName,
    line.invoice.vendorName,
    `#${line.invoice.invoiceNumber ?? "-"}`,
    line.invoice.invoiceDate?.toISOString().slice(0, 10) ?? "-",
    `sku=${line.sku ?? "-"}`,
  ].join(" · ")
}

function packLabel(line: LinePreview): string {
  return `${line.unit ?? "-"} x ${line.packSize ?? "-"} x ${line.unitSize ?? "-"} x ${line.unitSizeUom ?? "-"}`
}

function printLinePatch(
  title: string,
  line: LinePreview | null,
  patch: { unit?: string; packSize?: number; unitSize?: number; unitSizeUom?: string }
): void {
  console.log(`\n${title}`)
  if (!line) {
    console.log("  missing target line")
    return
  }
  console.log(`  ${lineLabel(line)}`)
  console.log(`  before: ${packLabel(line)} ext=${money(line.extendedPrice)}`)
  console.log(
    `  after:  ${patch.unit ?? line.unit ?? "-"} x ${patch.packSize ?? line.packSize ?? "-"} x ${patch.unitSize ?? line.unitSize ?? "-"} x ${patch.unitSizeUom ?? line.unitSizeUom ?? "-"}`
  )
}

async function previewDerived(
  line: LinePreview,
  patch: { unit?: string; packSize?: number; unitSize?: number; unitSizeUom?: string }
): Promise<void> {
  const { deriveCostFromLineItem } = await import("../src/lib/ingredient-cost")
  const recipeUnit = line.canonicalIngredient?.recipeUnit
  if (!recipeUnit) return
  const before = deriveCostFromLineItem(line, recipeUnit)
  const after = deriveCostFromLineItem(
    {
      ...line,
      unit: patch.unit ?? line.unit,
      packSize: patch.packSize ?? line.packSize,
      unitSize: patch.unitSize ?? line.unitSize,
      unitSizeUom: patch.unitSizeUom ?? line.unitSizeUom,
    },
    recipeUnit
  )
  console.log(
    `  derived: ${before == null ? "-" : money(before)}/${recipeUnit} -> ${after == null ? "-" : money(after)}/${recipeUnit}`
  )
}

async function main(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma")

  console.log(
    `Flagged ingredient cost repair — ${COMMIT ? "COMMIT" : "DRY RUN"}`
  )

  const [sauceLine, bagLine, lettuceLines, lettuceCanonical] = await Promise.all([
    prisma.invoiceLineItem.findUnique({
      where: { id: SAUCE_LINE_ID },
      select: lineSelect(),
    }),
    prisma.invoiceLineItem.findUnique({
      where: { id: BAG_LINE_ID },
      select: lineSelect(),
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        sku: LETTUCE_SKU,
        canonicalIngredient: { name: LETTUCE_NAME },
        OR: [
          { packSize: { in: [11, 12] } },
          { packSize: 1, unitSize: 12 },
        ],
      },
      select: lineSelect(),
      orderBy: { invoice: { invoiceDate: "asc" } },
    }),
    prisma.canonicalIngredient.findFirst({
      where: { name: LETTUCE_NAME },
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
        costLocked: true,
      },
    }),
  ])

  const saucePatch = { unitSizeUom: "LB" }
  const bagPatch = { packSize: 11, unitSize: 1000, unitSizeUom: "CT" }
  const lettucePatch = { packSize: 112, unitSize: 1, unitSizeUom: "CT" }

  printLinePatch("Sauce metadata", sauceLine, saucePatch)
  if (sauceLine) await previewDerived(sauceLine, saucePatch)

  console.log(`\nLettuce metadata (${lettuceLines.length} malformed line(s))`)
  for (const line of lettuceLines) {
    console.log(`  ${lineLabel(line)}`)
    console.log(`    ${packLabel(line)} -> CS x 112 x 1 x CT`)
    await previewDerived(line, lettucePatch)
  }

  console.log("\nLettuce canonical")
  if (!lettuceCanonical) {
    console.log("  missing canonical")
  } else {
    console.log(
      `  before: ${money(lettuceCanonical.costPerRecipeUnit)}/${lettuceCanonical.recipeUnit ?? "-"} ` +
        `source=${lettuceCanonical.costSource ?? "-"} locked=${lettuceCanonical.costLocked}`
    )
    console.log(
      `  after:  ${money(LETTUCE_COST_PER_EACH)}/each source=invoice locked=false`
    )
  }

  printLinePatch("Bag metadata", bagLine, bagPatch)
  if (bagLine) await previewDerived(bagLine, bagPatch)

  console.log("\nPickles")
  console.log(
    "  intentionally unchanged: invoice metadata is incomplete; manual locked price stays authoritative."
  )

  if (!COMMIT) {
    console.log("\nDry run complete. Re-run with --commit to apply.")
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(async (tx) => {
    if (sauceLine) {
      await tx.invoiceLineItem.update({
        where: { id: SAUCE_LINE_ID },
        data: saucePatch,
      })
    }

    for (const line of lettuceLines) {
      await tx.invoiceLineItem.update({
        where: { id: line.id },
        data: lettucePatch,
      })
    }

    if (lettuceCanonical) {
      await tx.canonicalIngredient.update({
        where: { id: lettuceCanonical.id },
        data: {
          recipeUnit: "each",
          costPerRecipeUnit: LETTUCE_COST_PER_EACH,
          costSource: "invoice",
          costLocked: false,
          costUpdatedAt: new Date(),
        },
      })
    }

    if (bagLine) {
      await tx.invoiceLineItem.update({
        where: { id: BAG_LINE_ID },
        data: bagPatch,
      })
    }
  })

  console.log("\nCommitted flagged ingredient cost repairs.")
  await prisma.$disconnect()
}

function lineSelect() {
  return {
    id: true,
    sku: true,
    productName: true,
    quantity: true,
    unit: true,
    packSize: true,
    unitSize: true,
    unitSizeUom: true,
    extendedPrice: true,
    invoice: {
      select: {
        invoiceNumber: true,
        invoiceDate: true,
        vendorName: true,
      },
    },
    canonicalIngredient: {
      select: {
        name: true,
        recipeUnit: true,
      },
    },
  } as const
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
