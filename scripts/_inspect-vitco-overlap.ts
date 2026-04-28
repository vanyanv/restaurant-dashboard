// Throwaway probe: list canonical ingredients + recent non-Vitco line items
// so we can see what overlaps with the Vitco invoices. Deletable after use.

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

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const canonicals = await prisma.canonicalIngredient.findMany({
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costSource: true,
      aliases: { select: { rawName: true } },
    },
    orderBy: { name: "asc" },
  })

  console.log(`\n=== CanonicalIngredient (${canonicals.length}) ===`)
  for (const c of canonicals) {
    const aliases = c.aliases.map((a) => a.rawName).join(" | ")
    console.log(
      `${c.name.padEnd(40)} unit=${(c.recipeUnit ?? "-").padEnd(6)} $=${
        c.costPerRecipeUnit != null ? c.costPerRecipeUnit.toFixed(4) : "-"
      } src=${c.costSource ?? "-"}${aliases ? `  aliases: ${aliases}` : ""}`
    )
  }

  const vendors = await prisma.invoice.groupBy({
    by: ["vendorName"],
    _count: { _all: true },
    orderBy: { vendorName: "asc" },
  })
  console.log(`\n=== Vendors in Invoice table ===`)
  for (const v of vendors) {
    console.log(`${v.vendorName}  (${v._count._all} invoices)`)
  }

  const sample = await prisma.invoiceLineItem.findMany({
    where: { canonicalIngredientId: { not: null } },
    select: {
      productName: true,
      sku: true,
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
      canonicalIngredientId: true,
      canonicalIngredient: { select: { name: true, recipeUnit: true } },
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: 200,
  })
  console.log(`\n=== Recent matched invoice line items (${sample.length}) ===`)
  for (const l of sample) {
    console.log(
      `[${l.invoice.vendorName.padEnd(18)} ${l.invoice.invoiceDate
        .toISOString()
        .slice(0, 10)}] ${(l.canonicalIngredient?.name ?? "?").padEnd(
        30
      )} ← ${l.productName.slice(0, 45).padEnd(45)} qty=${l.quantity} pack=${
        l.packSize ?? "-"
      }x${l.unitSize ?? "-"}${l.unitSizeUom ?? l.unit ?? ""} ext=$${l.extendedPrice.toFixed(
        2
      )} unit$=${l.unitPrice.toFixed(2)}`
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
