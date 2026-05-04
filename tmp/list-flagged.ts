import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { findPackShapeAnomalies } = await import("../src/lib/invoice-sanity")
  const lines = await prisma.invoiceLineItem.findMany({
    select: {
      lineNumber: true, productName: true, unit: true, packSize: true,
      unitSize: true, unitSizeUom: true,
      invoice: { select: { id: true, vendorName: true, invoiceNumber: true, invoiceDate: true } },
    },
  })
  const byInvoice = new Map<string, typeof lines>()
  for (const l of lines) {
    const arr = byInvoice.get(l.invoice.id) ?? []
    arr.push(l); byInvoice.set(l.invoice.id, arr)
  }
  const flagged: { id: string; vendor: string; invNum: string; date: string; anomalies: number }[] = []
  for (const [id, ls] of byInvoice) {
    const inv = ls[0].invoice
    const liShapes = ls.map((l) => ({
      lineNumber: l.lineNumber, productName: l.productName, unit: l.unit,
      packSize: l.packSize, unitSize: l.unitSize, unitSizeUom: l.unitSizeUom,
      sku: null, description: null, category: null,
      quantity: 0, unitPrice: 0, extendedPrice: 0,
    }))
    const a = findPackShapeAnomalies(liShapes)
    if (a.length === 0) continue
    flagged.push({
      id, vendor: inv.vendorName, invNum: inv.invoiceNumber,
      date: inv.invoiceDate?.toISOString().slice(0,10) ?? "—",
      anomalies: a.length,
    })
  }
  flagged.sort((a, b) => a.date.localeCompare(b.date))
  for (const f of flagged) {
    console.log(`${f.id}\t${f.date}\t${f.vendor.padEnd(40)}\t#${f.invNum.padEnd(15)}\t${f.anomalies} anomalies`)
  }
  console.log(`\nTotal: ${flagged.length} flagged invoices`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
