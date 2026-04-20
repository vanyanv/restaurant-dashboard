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

  const targets = process.argv.slice(2)
  const where = targets.length > 0
    ? { itemName: { in: targets } }
    : { category: { in: ["A La Carte", "Secret Menu", "On The Side"] } }

  const recs = await prisma.recipe.findMany({
    where,
    select: { id: true, itemName: true, category: true, foodCostOverride: true },
    orderBy: [{ category: "asc" }, { itemName: "asc" }],
  })

  for (const r of recs) {
    const res = await computeRecipeCost(r.id)
    const overrideStr = r.foodCostOverride != null ? ` (override=$${r.foodCostOverride.toFixed(2)})` : ""
    console.log(`\n  ${r.itemName}  [${r.category}]  →  $${res.totalCost.toFixed(4)}${overrideStr}`)
    for (const ln of res.lines) {
      const cu = ln.costUnit ?? ln.unit
      const kind = ln.kind === "component" ? "🍱" : "🥬"
      const uc = ln.unitCost != null ? `$${ln.unitCost.toFixed(4)}/${cu}` : "—"
      console.log(`      ${kind} ${ln.quantity} ${ln.unit}  ${ln.name.padEnd(42)}  ${uc}  = $${ln.lineCost.toFixed(4)}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
