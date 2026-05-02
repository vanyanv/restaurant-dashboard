// scripts/audit-verify.ts — read-only sanity checks on the audit script's output.
import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

const HOLLYWOOD = "cmexd4zia0001jr04ljkdt9na"

async function main() {
  const { prisma } = await import("@/lib/prisma")

  // Step 1: row counts
  const store = await prisma.store.findUnique({ where: { id: HOLLYWOOD } })
  if (!store) throw new Error("no store")
  const canonicals = await prisma.canonicalIngredient.count({
    where: { accountId: store.accountId },
  })
  const recipes = await prisma.recipe.count({
    where: { accountId: store.accountId },
  })
  const sellable = await prisma.recipe.count({
    where: { accountId: store.accountId, isSellable: true },
  })
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const dailyCogs = await prisma.dailyCogsItem.count({
    where: { storeId: HOLLYWOOD, date: { gte: since } },
  })
  console.log(JSON.stringify({ canonicals, recipes, sellable, dailyCogs }, null, 2))

  // Step 2: confirm Single Slider walks deterministically
  const { computeRecipeCost } = await import("@/lib/recipe-cost")
  const single = await prisma.recipe.findFirst({
    where: { accountId: store.accountId, itemName: "Single Slider" },
  })
  if (single) {
    const result = await computeRecipeCost(single.id)
    console.log("Single Slider walk:", JSON.stringify({
      recipeId: single.id,
      total: result.totalCost,
      partial: result.partial,
      lines: result.lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit, unitCost: l.unitCost, costUnit: l.costUnit, lineCost: l.lineCost, missing: l.missingCost })),
    }, null, 2))
  }

  // Step 3: re-derive ground beef cost from latest invoice
  const beef = await prisma.canonicalIngredient.findFirst({
    where: { accountId: store.accountId, name: { contains: "ground beef" } },
  })
  if (beef) {
    const latest = await prisma.invoiceLineItem.findFirst({
      where: { canonicalIngredientId: beef.id },
      orderBy: { invoice: { invoiceDate: "desc" } },
      include: { invoice: { select: { invoiceDate: true, vendorName: true } } },
    })
    console.log("ground beef:", JSON.stringify({
      name: beef.name,
      recipeUnit: beef.recipeUnit,
      cost: beef.costPerRecipeUnit,
      costSource: beef.costSource,
      latestLine: latest && {
        sku: latest.sku,
        productName: latest.productName,
        qty: latest.quantity,
        unit: latest.unit,
        packSize: latest.packSize,
        unitSize: latest.unitSize,
        unitSizeUom: latest.unitSizeUom,
        unitPrice: latest.unitPrice,
        extendedPrice: latest.extendedPrice,
        invoiceDate: latest.invoice.invoiceDate,
        vendor: latest.invoice.vendorName,
      },
    }, null, 2))
  }

  // Step 4: spot-check tomato (the conversion-gap + suspect cost), lettuce (suspect cost), relish (zero cost)
  for (const name of ["imported fresh tomato bulk 5x6 fresh", "packer lettuce boston hydroponic", "relish sweet"]) {
    const c = await prisma.canonicalIngredient.findFirst({
      where: { accountId: store.accountId, name },
      include: {
        invoiceLineItems: {
          orderBy: { invoice: { invoiceDate: "desc" } },
          take: 3,
          include: { invoice: { select: { invoiceDate: true, vendorName: true } } },
        },
        skuMatches: true,
      },
    })
    if (c) {
      console.log(`${name}:`, JSON.stringify({
        recipeUnit: c.recipeUnit,
        cost: c.costPerRecipeUnit,
        costSource: c.costSource,
        costLocked: c.costLocked,
        skuMatches: c.skuMatches.map((m) => ({ vendor: m.vendorName, sku: m.sku, fromUnit: m.fromUnit, toUnit: m.toUnit, factor: m.conversionFactor })),
        lines: c.invoiceLineItems.map((l) => ({ vendor: l.invoice.vendorName, sku: l.sku, qty: l.quantity, unit: l.unit, packSize: l.packSize, unitSize: l.unitSize, unitSizeUom: l.unitSizeUom, unitPrice: l.unitPrice, extendedPrice: l.extendedPrice, date: l.invoice.invoiceDate })),
      }, null, 2))
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
