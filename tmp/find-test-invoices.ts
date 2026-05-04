import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const targets = [
    { sku: "2717106", vendor: "Sysco", label: "lettuce" },
    { sku: "813", vendor: "Premier Deli", label: "pickle" },
    { sku: "G299", vendor: "Premier Deli", label: "chilli" },
  ]

  for (const t of targets) {
    console.log(`\n== ${t.label} (sku=${t.sku}) ==`)
    const lines = await prisma.invoiceLineItem.findMany({
      where: { sku: t.sku },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 5,
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
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            vendorName: true,
            emailMessageId: true,
          },
        },
      },
    })
    for (const l of lines) {
      const date = l.invoice.invoiceDate?.toISOString().slice(0, 10) ?? "—"
      console.log(
        `  ${l.invoice.id}  ${date}  ${l.invoice.vendorName.padEnd(40)}  qty=${l.quantity} ${l.unit ?? "-"}  pack=${l.packSize ?? "-"} × size=${l.unitSize ?? "-"} ${l.unitSizeUom ?? "-"}  unitPrice=$${l.unitPrice}  extPrice=$${l.extendedPrice}  msgId=${l.invoice.emailMessageId ? "YES" : "NO"}`
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
