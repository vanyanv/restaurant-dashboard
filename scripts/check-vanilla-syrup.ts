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

  const shakes = await prisma.recipe.findMany({
    where: { itemName: { contains: "Shake", mode: "insensitive" } },
    include: {
      ingredients: { include: { canonicalIngredient: { select: { name: true } } } },
      usedInIngredients: true,
    },
    orderBy: { itemName: "asc" },
  })

  for (const r of shakes) {
    console.log(`\n  ${r.itemName}  [${r.category}]`)
    if (r.notes) console.log(`    notes: ${r.notes}`)
    for (const ing of r.ingredients) {
      console.log(`    🥬 ${ing.quantity} ${ing.unit}  ${ing.canonicalIngredient?.name ?? "?"}  (displayAs=${ing.displayAs ?? "—"})`)
    }
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
