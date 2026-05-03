import { loadEnvLocal } from "./audit/lib"

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")

  const all = await prisma.recipe.findMany({
    select: { id: true, itemName: true, servingSize: true, foodCostOverride: true },
    orderBy: { servingSize: "desc" },
  })

  const total = all.length
  const nullSize = all.filter((r) => r.servingSize == null).length
  const eqOne = all.filter((r) => r.servingSize === 1).length
  const gtOne = all.filter((r) => r.servingSize != null && r.servingSize > 1)
  const ltOne = all.filter((r) => r.servingSize != null && r.servingSize > 0 && r.servingSize < 1)
  const zeroOrNeg = all.filter((r) => r.servingSize != null && r.servingSize <= 0)

  console.log(`Recipe total: ${total}`)
  console.log(`  servingSize == null : ${nullSize}`)
  console.log(`  servingSize == 1    : ${eqOne}`)
  console.log(`  servingSize > 1     : ${gtOne.length}`)
  console.log(`  0 < servingSize < 1 : ${ltOne.length}`)
  console.log(`  servingSize <= 0    : ${zeroOrNeg.length}`)

  if (gtOne.length > 0) {
    console.log("\nRecipes with servingSize > 1 (top 30 by size):")
    for (const r of gtOne.slice(0, 30)) {
      console.log(`  size=${r.servingSize}  name="${r.itemName}"  override=${r.foodCostOverride}`)
    }
  }

  if (zeroOrNeg.length > 0) {
    console.log("\nRecipes with servingSize <= 0 (data hazard):")
    for (const r of zeroOrNeg) {
      console.log(`  size=${r.servingSize}  name="${r.itemName}"`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
