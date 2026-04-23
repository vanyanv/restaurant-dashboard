// One-off: re-run matchNewLineItems for the invoices just reprocessed.
// reprocess-invoices.ts deletes+re-creates line items, which wipes the
// canonicalIngredientId FK. This restores sku/alias linkage.
import { loadEnvLocal } from "./lib"
loadEnvLocal()

// Accepts --ids=a,b,c on the command line; defaults to the initial 14-invoice
// reprocess batch. Re-runnable after subsequent reprocess waves.
const idsArg = process.argv.find((a) => a.startsWith("--ids="))
const IDS = idsArg
  ? idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : [
      "cmn80us56002404jxhelpbyg0",
      "cmo6ug6hb000ekeu99f6y3x1v",
      "cmoa1wl6t000004l29buyl779",
      "cmo5093vc0002lfu9sitaow8m",
      "cmo5096qc001wlfu9t9r2us61",
      "cmmjjny5100iyx5u9gb59w8ep",
      "cmo6uo8hh0053keu9qvmlqqe0",
      "cmo7ju8r0000004l27v47mhne",
      "cmmjjnzlr00jlx5u93behunss",
      "cmo7ju8zb000n04l284rvw65c",
      "cmo6uig6d001vkeu9i1vb04fd",
      "cmmjjnzaw00jhx5u9wq57rhx2",
      "cmo6uo135004ykeu94cul52r9",
      "cmo6uptj5005vkeu9bw50ga46",
    ]

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { matchNewLineItems } = await import("../../src/lib/ingredient-matching")

  const owners = await prisma.invoice.groupBy({
    by: ["ownerId"],
    where: { id: { in: IDS } },
    _count: { _all: true },
  })

  for (const o of owners) {
    const invoiceIds = (
      await prisma.invoice.findMany({
        where: { id: { in: IDS }, ownerId: o.ownerId },
        select: { id: true },
      })
    ).map((i) => i.id)
    console.log(`Owner ${o.ownerId}: matching ${invoiceIds.length} invoices`)
    const result = await matchNewLineItems(o.ownerId, invoiceIds)
    console.log("  result:", result)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
