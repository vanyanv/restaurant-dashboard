// One-off: dump an invoice's stored data + raw extraction JSON.
import { loadEnvLocal } from "./lib"
loadEnvLocal()

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error("Usage: pnpm tsx scripts/audit/inspect-invoice.ts <invoiceId>")
    process.exit(2)
  }
  const { prisma } = await import("../../src/lib/prisma")
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: {
      vendorName: true,
      invoiceNumber: true,
      totalAmount: true,
      subtotal: true,
      taxAmount: true,
      rawExtractionJson: true,
      lineItems: {
        select: { lineNumber: true, productName: true, quantity: true, unit: true, unitPrice: true, extendedPrice: true },
        orderBy: { lineNumber: "asc" },
      },
    },
  })
  console.log(`${inv?.vendorName} ${inv?.invoiceNumber}`)
  console.log(`  totalAmount=${inv?.totalAmount}  subtotal=${inv?.subtotal}  taxAmount=${inv?.taxAmount}`)
  const lineSum = (inv?.lineItems ?? []).reduce((s, l) => s + l.extendedPrice, 0)
  console.log(`  lineSum=${lineSum}  delta=${(inv?.totalAmount ?? 0) - lineSum - (inv?.taxAmount ?? 0)}`)
  console.log("Stored line items:")
  for (const l of inv?.lineItems ?? []) {
    console.log(`  ${l.lineNumber}. ${l.productName}  qty=${l.quantity} ${l.unit}  unitPrice=${l.unitPrice}  ext=${l.extendedPrice}`)
  }
  console.log("\n--- raw extraction JSON ---")
  console.log(inv?.rawExtractionJson)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
