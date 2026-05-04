import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const inv = await prisma.invoice.findUnique({
    where: { id: "cmoiasrgo000004kwu9z0uvv9" },
    select: {
      vendorName: true, invoiceNumber: true, totalAmount: true, status: true,
      lineItems: {
        orderBy: { lineNumber: "asc" },
        select: {
          lineNumber: true, sku: true, productName: true, unit: true,
          packSize: true, unitSize: true, unitSizeUom: true,
          quantity: true, unitPrice: true, extendedPrice: true,
        },
      },
    },
  })
  if (!inv) { console.log("not found"); return }
  console.log(`${inv.vendorName} #${inv.invoiceNumber}  status=${inv.status}  total=$${inv.totalAmount}`)
  let sum = 0
  for (const l of inv.lineItems) {
    sum += l.extendedPrice
    console.log(`  L${String(l.lineNumber).padStart(2)} sku=${(l.sku ?? "-").padEnd(10)} qty=${l.quantity} ${(l.unit ?? "-").padEnd(4)} pack=${l.packSize ?? "-"} × size=${l.unitSize ?? "-"} ${(l.unitSizeUom ?? "-").padEnd(6)} $${l.unitPrice}/u ext=$${l.extendedPrice} ${l.productName.slice(0, 40)}`)
  }
  console.log(`Line sum: $${sum.toFixed(2)} (vs invoice total $${inv.totalAmount})`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
