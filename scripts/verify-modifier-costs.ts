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
  const { computeRecipeCost } = await import("../src/lib/recipe-cost")

  const mods = await prisma.recipe.findMany({
    where: { category: "Modifier" },
    select: { id: true, itemName: true },
    orderBy: { itemName: "asc" },
  })
  console.log("=== MODIFIER RECIPE COSTS ===")
  for (const m of mods) {
    const r = await computeRecipeCost(m.id)
    console.log(
      `\n  ${m.itemName.padEnd(30)} total=$${r.totalCost.toFixed(4)} partial=${r.partial}`
    )
    for (const ln of r.lines) {
      const cu = ln.costUnit ?? ln.unit
      const src = ln.kind === "component" ? "[sub]" : `[${ln.costSource ?? "-"}]`
      console.log(
        `      ${ln.name.padEnd(28)} ${ln.quantity} ${ln.unit} × $${ln.unitCost?.toFixed(4) ?? "—"}/${cu} = $${ln.lineCost.toFixed(4)} ${src}`
      )
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
