import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      OR: [
        { sku: "3812807" }, // Sysco Packer Onion Sweet
        { sku: "1763432" }, // Sysco Tomato Bulk
      ],
    },
    select: {
      sku: true,
      productName: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      quantity: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { invoiceNumber: true, invoiceDate: true } },
    },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: 20,
  })
  for (const l of lines) {
    const date = l.invoice.invoiceDate?.toISOString().slice(0, 10) ?? "—"
    console.log(`  ${date} #${l.invoice.invoiceNumber} sku=${l.sku} qty=${l.quantity} ${l.unit ?? "-"} pack=${l.packSize ?? "-"} × size=${l.unitSize ?? "-"} ${l.unitSizeUom ?? "-"} $${l.unitPrice}/u ext=$${l.extendedPrice} ${l.productName.slice(0, 35)}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
