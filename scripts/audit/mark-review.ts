// One-off: set status=REVIEW on the 3 invoices whose line-arithmetic can't be
// resolved by re-extraction (catch-weight meat, zero-charge promo line). This
// surfaces them in the invoice review queue for manual PDF inspection.
import { loadEnvLocal } from "./lib"
loadEnvLocal()

const STUBBORN = [
  "cmoa1wl6t000004l29buyl779", // Sysco 945831303 "Beef Ground Bulk 75/25 CHUB" — catch-weight
  "cmn80us56002404jxhelpbyg0", // Premier Meats 2232461 "GROUND BEEF CREEKSTONE" — catch-weight
  "cmo5096qc001wlfu9t9r2us61", // IFS H04728-00 "Syrup Hi-C Fruit Punch" — zero-charge
]

const APPLY = process.argv.includes("--apply")

async function main() {
  const { prisma } = await import("../../src/lib/prisma")

  const before = await prisma.invoice.findMany({
    where: { id: { in: STUBBORN } },
    select: { id: true, vendorName: true, invoiceNumber: true, status: true },
  })
  console.log("Current status:")
  for (const i of before) console.log(`  ${i.status.padEnd(9)} ${i.vendorName} #${i.invoiceNumber}  (${i.id})`)

  if (!APPLY) {
    console.log("\n(dry run — re-run with --apply to set status=REVIEW)")
    await prisma.$disconnect()
    return
  }

  const result = await prisma.invoice.updateMany({
    where: { id: { in: STUBBORN } },
    data: { status: "REVIEW" },
  })
  console.log(`\nUpdated ${result.count} invoice(s) to status=REVIEW.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
