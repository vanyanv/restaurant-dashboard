import fs from "node:fs"
import path from "node:path"

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
  const date = process.argv[2] ?? "2025-05-02"
  const { prisma } = await import("../src/lib/prisma")
  try {
    const store = await prisma.store.findFirst({ where: { name: { contains: "Hollywood", mode: "insensitive" } } })
    if (!store) { console.error("no Hollywood store"); return }
    const rows = await prisma.otterDailySummary.findMany({
      where: { storeId: store.id, date: new Date(date) },
    })
    console.log(`Store: ${store.name} (${store.id})  Date: ${date}`)
    console.log(`Rows: ${rows.length}`)
    for (const r of rows) {
      console.log(
        `${r.platform.padEnd(12)} ${r.paymentMethod.padEnd(6)} fpGross=${String(r.fpGrossSales).padStart(10)} fpNet=${String(r.fpNetSales).padStart(10)} fpTax=${String(r.fpTaxCollected).padStart(8)} tpGross=${String(r.tpGrossSales).padStart(10)} tpDisc=${String(r.tpDiscounts).padStart(10)}`
      )
    }
  } finally {
    await (await import("../src/lib/prisma")).prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
