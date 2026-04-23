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
    if (!store) { console.error("no Hollywood store"); return }

    // Earliest + latest css-pos CARD dates
    const cardAgg = await prisma.otterDailySummary.aggregate({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CARD" },
      _min: { date: true }, _max: { date: true }, _count: true,
    })
    const cashAgg = await prisma.otterDailySummary.aggregate({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CASH" },
      _min: { date: true }, _max: { date: true }, _count: true,
    })
    console.log("css-pos CARD:", cardAgg._count, "rows", cardAgg._min.date, "→", cardAgg._max.date)
    console.log("css-pos CASH:", cashAgg._count, "rows", cashAgg._min.date, "→", cashAgg._max.date)

    // Count CASH rows with non-null fpGross vs null
    const cashNonNull = await prisma.otterDailySummary.count({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CASH", fpGrossSales: { not: null } },
    })
    const cashNull = await prisma.otterDailySummary.count({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CASH", fpGrossSales: null },
    })
    console.log(`css-pos CASH fpGross non-null: ${cashNonNull}, null: ${cashNull}`)

    // Count CARD rows with non-null fpGross vs null
    const cardNonNull = await prisma.otterDailySummary.count({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CARD", fpGrossSales: { not: null } },
    })
    const cardNull = await prisma.otterDailySummary.count({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CARD", fpGrossSales: null },
    })
    console.log(`css-pos CARD fpGross non-null: ${cardNonNull}, null: ${cardNull}`)

    // Find the earliest date with a css-pos CARD row — that tells us when Hollywood sync started working
    const firstCard = await prisma.otterDailySummary.findFirst({
      where: { storeId: store.id, platform: "css-pos", paymentMethod: "CARD", fpGrossSales: { not: null } },
      orderBy: { date: "asc" }, select: { date: true, fpGrossSales: true },
    })
    console.log("First non-null CARD:", firstCard)

    // All dates for any Hollywood row (all platforms)
    const anyAgg = await prisma.otterDailySummary.aggregate({
      where: { storeId: store.id },
      _min: { date: true }, _max: { date: true }, _count: true,
    })
    console.log("All Hollywood rows:", anyAgg._count, "rows", anyAgg._min.date, "→", anyAgg._max.date)
  } finally {
    await (await import("../src/lib/prisma")).prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
