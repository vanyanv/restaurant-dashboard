import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")
  const targets = ["Single Slider", "Double Slider", "Triple Slider", "The Quad", "Grilled Cheese", "Extra Chris N Eddy's Sauce"]
  const recs = await prisma.recipe.findMany({
    where: { itemName: { in: targets } },
    select: { id: true, itemName: true, foodCostOverride: true },
  })
  const byName = new Map(recs.map((r) => [r.itemName, r]))

  console.log("=== CORE RECIPE COSTS ===\n")
  for (const name of targets) {
    const r = byName.get(name)
    if (!r) { console.log(`  ${name}: NOT FOUND`); continue }
    const res = await computeRecipeCost(r.id)
    const overrideStr = r.foodCostOverride != null ? `$${r.foodCostOverride.toFixed(2)}` : "—"
    console.log(`  ${name.padEnd(30)} computed=$${res.totalCost.toFixed(4)}  (was override=${overrideStr})  partial=${res.partial}`)
    for (const ln of res.lines) {
      const cu = ln.costUnit ?? ln.unit
      const uc = ln.unitCost != null ? `$${ln.unitCost.toFixed(4)}/${cu}` : "—"
      console.log(`      ${ln.name.padEnd(42)} ${ln.quantity} ${ln.unit}  ${uc}  = $${ln.lineCost.toFixed(4)}`)
    }
    console.log()
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
