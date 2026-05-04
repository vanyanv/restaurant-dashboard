// Scan stored line items for suspicious LB / OZ / GAL extractions where
// unitSize is implausibly large for the UoM. Read-only.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      OR: [
        { unitSizeUom: "LB", unitSize: { gt: 50 } },
        { unitSizeUom: "GAL", unitSize: { gt: 10 } },
      ],
    },
    select: {
      productName: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      quantity: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { vendorName: true, invoiceNumber: true } },
    },
    orderBy: { unitSize: "desc" },
  })

  console.log(`Found ${lines.length} suspicious line items (LB > 50 or GAL > 10):\n`)
  for (const l of lines) {
    console.log(
      `  ${l.invoice.vendorName.padEnd(35)} #${l.invoice.invoiceNumber.padEnd(12)}  ` +
      `${l.unit ?? "-"} pack=${l.packSize ?? "-"} × size=${l.unitSize} ${l.unitSizeUom} ` +
      `unitPrice=$${l.unitPrice}  ${l.productName.slice(0, 50)}`
    )
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
