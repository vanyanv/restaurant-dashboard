import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const queries = [
    { sku: "2717106", name: "Lettuce Boston" },
    { sku: "1008200", name: "Propack Lettuce" },
    { sku: "3812807", name: "Onion" },
    { sku: "1763432", name: "Tomato" },
    { sku: "4685614", name: "Gloves" },
  ]
  for (const q of queries) {
    const lines = await prisma.invoiceLineItem.findMany({
      where: { sku: q.sku },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 3,
      select: {
        unit: true, packSize: true, unitSize: true, unitSizeUom: true,
        quantity: true, extendedPrice: true,
        invoice: { select: { invoiceNumber: true, invoiceDate: true } },
      },
    })
    console.log(`\n${q.name} (sku=${q.sku}):`)
    for (const l of lines) {
      const date = l.invoice.invoiceDate?.toISOString().slice(0,10) ?? "—"
      console.log(`  ${date} #${l.invoice.invoiceNumber}  qty=${l.quantity} ${l.unit ?? "-"}  pack=${l.packSize ?? "-"} × size=${l.unitSize ?? "-"} ${l.unitSizeUom ?? "-"}  ext=$${l.extendedPrice}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
