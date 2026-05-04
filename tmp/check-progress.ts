import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { findPackShapeAnomalies } = await import("../src/lib/invoice-sanity")
  const lines = await prisma.invoiceLineItem.findMany({
    select: {
      lineNumber: true, productName: true, unit: true, packSize: true,
      unitSize: true, unitSizeUom: true,
      invoice: { select: { id: true, invoiceNumber: true, vendorName: true, invoiceDate: true } },
    },
  })
  const byInv = new Map<string, typeof lines>()
  for (const l of lines) {
    const a = byInv.get(l.invoice.id) ?? []
    a.push(l); byInv.set(l.invoice.id, a)
  }
  let stillFlagged = 0
  for (const [_id, ls] of byInv) {
    const liShapes = ls.map((l) => ({
      lineNumber: l.lineNumber, productName: l.productName, unit: l.unit,
      packSize: l.packSize, unitSize: l.unitSize, unitSizeUom: l.unitSizeUom,
      sku: null, description: null, category: null,
      quantity: 0, unitPrice: 0, extendedPrice: 0,
    }))
    if (findPackShapeAnomalies(liShapes).length > 0) stillFlagged++
  }
  console.log(`Total invoices: ${byInv.size}`)
  console.log(`Still flagged with pack-shape anomalies: ${stillFlagged}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
