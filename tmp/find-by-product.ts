import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const queries = [
    { label: "Propack Lettuce", productLike: "Propack Lettuce" },
    { label: "Patty Paper 81000", productLike: "Paper Patty" },
    { label: "T-Shirt bag 11000", productLike: "T-Shirt" },
  ]
  for (const q of queries) {
    const lines = await prisma.invoiceLineItem.findMany({
      where: { productName: { contains: q.productLike, mode: "insensitive" } },
      take: 2,
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: {
        productName: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        invoice: { select: { id: true, vendorName: true, invoiceNumber: true } },
      },
    })
    console.log(`\n== ${q.label} ==`)
    for (const l of lines) {
      console.log(`  ${l.invoice.id}  ${l.invoice.vendorName} #${l.invoice.invoiceNumber}  ${l.productName.slice(0, 45)}  pack=${l.packSize} × size=${l.unitSize} ${l.unitSizeUom}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
