import { loadEnvLocal } from "./audit/lib"

async function main() {
  loadEnvLocal()
  const { prisma } = await import("@/lib/prisma")
  const { CONTAINER_CANDIDATE_NAMES } = await import("@/lib/container-packaging")

  const hollywood = await prisma.store.findFirst({
    where: { name: { contains: "Hollywood" } },
    select: { id: true, accountId: true, name: true },
  })
  if (!hollywood) throw new Error("Hollywood not found")

  const end = new Date("2026-05-17T00:00:00.000Z")
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30)

  // 1) Which days have packaging rows with MISSING_COST?
  const missing = await prisma.dailyCogsItem.findMany({
    where: {
      storeId: hollywood.id,
      category: "Packaging",
      status: "MISSING_COST",
      date: { gte: start, lte: end },
    },
    select: { date: true, itemName: true, qtySold: true, unitCost: true },
    orderBy: { date: "asc" },
  })
  console.log(`=== Packaging rows with MISSING_COST (last 30d) ===`)
  for (const r of missing) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  ${r.itemName.padEnd(35)} qty=${r.qtySold}  unitCost=${r.unitCost}`)
  }
  console.log()

  // 2) Container cost catalog — pull canonical ingredients & latest unit cost
  console.log(`=== Container cost catalog (Hollywood, latest as of ${end.toISOString().slice(0,10)}) ===`)
  const { getCanonicalIngredientCost } = await import("@/lib/canonical-ingredients")
  for (const canonical of CONTAINER_CANDIDATE_NAMES) {
    const ci = await prisma.canonicalIngredient.findFirst({
      where: { accountId: hollywood.accountId, name: canonical },
      select: { id: true, name: true },
    })
    if (!ci) { console.log(`  [no canonical] ${canonical}`); continue }
    const cost = await getCanonicalIngredientCost(ci.id, end, { storeId: hollywood.id })
    console.log(`  unit$=${(cost?.unitCost ?? "—").toString().padStart(8)}  source=${cost?.source ?? "—"}  ${canonical}`)
  }
  console.log()

  // 3) How many takeaway orders had unclassified items? (sampled day)
  const sampleDate = new Date(end); sampleDate.setUTCDate(sampleDate.getUTCDate() - 1)
  const dayEnd = new Date(sampleDate); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1); dayEnd.setUTCMilliseconds(dayEnd.getUTCMilliseconds() - 1)
  const orders = await prisma.otterOrder.findMany({
    where: { storeId: hollywood.id, referenceTimeLocal: { gte: sampleDate, lte: dayEnd } },
    select: { fulfillmentMode: true, items: { select: { name: true, quantity: true, subItems: { select: { name: true, quantity: true, subHeader: true } } } } },
  })
  const { classifyBasket, isTakeawayFulfillmentMode } = await import("@/lib/container-packaging")
  let takeaway = 0
  const itemTally = new Map<string, { qty: number; reason: string }>()
  for (const o of orders) {
    if (!isTakeawayFulfillmentMode(o.fulfillmentMode)) continue
    takeaway += 1
    const c = classifyBasket({ fulfillmentMode: o.fulfillmentMode, items: o.items })
    for (const u of c.unclassifiedItems) {
      const k = u.name.toLowerCase()
      const e = itemTally.get(k) ?? { qty: 0, reason: u.reason }
      e.qty += u.quantity
      itemTally.set(k, e)
    }
  }
  console.log(`=== Unclassified items in takeaway orders on ${sampleDate.toISOString().slice(0,10)} (${takeaway} takeaway orders) ===`)
  const sorted = [...itemTally.entries()].sort((a,b) => b[1].qty - a[1].qty).slice(0, 25)
  for (const [name, e] of sorted) {
    console.log(`  qty=${String(e.qty).padStart(5)}  ${name.padEnd(50)} (${e.reason})`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
