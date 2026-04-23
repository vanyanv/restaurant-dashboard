// Compare batchRecipeCosts (list path) vs computeRecipeCost (detail path) for
// the sellable recipes, so we can tell if the two costing pipelines disagree.

import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { batchRecipeCosts } = await import("../src/lib/recipe-cost-batch")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")
  const { batchCanonicalCosts } = await import("../src/lib/canonical-cost-batch")

  const owners = await prisma.recipe.groupBy({ by: ["ownerId"], _count: { _all: true } })
  for (const o of owners) {
    console.log(`\nOwner ${o.ownerId}  (${o._count._all} recipes)`)

    const canonicalMap = await batchCanonicalCosts(o.ownerId)
    const batchMap = await batchRecipeCosts(o.ownerId, canonicalMap)

    const recipes = await prisma.recipe.findMany({
      where: { ownerId: o.ownerId, isSellable: true },
      select: { id: true, itemName: true, foodCostOverride: true },
      orderBy: { itemName: "asc" },
    })

    console.log(
      "RECIPE".padEnd(48) +
        "BATCH".padStart(10) +
        "WALK".padStart(10) +
        "OVERRIDE".padStart(10) +
        "Δ(B-W)".padStart(12)
    )
    for (const r of recipes) {
      const batch = batchMap.get(r.id)
      const walk = await computeRecipeCost(r.id).catch(() => null)
      const b = batch?.totalCost ?? 0
      const w = walk?.totalCost ?? 0
      const diff = b - w
      const marker = Math.abs(diff) > 0.01 ? "  ⚠" : ""
      console.log(
        r.itemName.padEnd(46).slice(0, 46) +
          ("$" + b.toFixed(2)).padStart(10) +
          ("$" + w.toFixed(2)).padStart(10) +
          (r.foodCostOverride != null ? "$" + r.foodCostOverride.toFixed(2) : "—").padStart(10) +
          ("$" + diff.toFixed(2)).padStart(12) +
          marker
      )
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
