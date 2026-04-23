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
  const { prisma } = await import("../src/lib/prisma")
  try {
    const store = await prisma.store.findFirst({ where: { name: { contains: "Hollywood", mode: "insensitive" } } })
    if (!store) return
    const rows = await prisma.otterDailySummary.findMany({
      where: { storeId: store.id, date: { gte: new Date("2025-04-28"), lte: new Date("2025-05-04") } },
      orderBy: [{ date: "asc" }, { platform: "asc" }, { paymentMethod: "asc" }],
      select: { date: true, platform: true, paymentMethod: true, fpGrossSales: true, fpOrderCount: true, tpGrossSales: true },
    })
    console.log(`Hollywood 2025-04-28..2025-05-04: ${rows.length} rows`)
    for (const r of rows) {
      console.log(
        `${r.date.toISOString().slice(0, 10)}  ${r.platform.padEnd(10)} ${r.paymentMethod.padEnd(6)}  fpGross=${String(r.fpGrossSales).padStart(10)}  fpOrd=${String(r.fpOrderCount ?? "").padStart(4)}  tpGross=${String(r.tpGrossSales).padStart(10)}`
      )
    }
  } finally {
    await (await import("../src/lib/prisma")).prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
