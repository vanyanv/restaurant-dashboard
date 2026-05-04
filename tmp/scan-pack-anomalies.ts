// Apply findPackShapeAnomalies to every InvoiceLineItem already in the DB
// to see what historical data the new sanity check would flag.
// READ-ONLY — no writes.

import { loadEnvLocal } from "../scripts/audit/lib"
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { findPackShapeAnomalies } = await import("../src/lib/invoice-sanity")

  // Pull every line, group by invoice, run the check, count.
  const lines = await prisma.invoiceLineItem.findMany({
    select: {
      lineNumber: true,
      productName: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      invoice: {
        select: {
          id: true,
          vendorName: true,
          invoiceNumber: true,
          invoiceDate: true,
          status: true,
        },
      },
    },
  })

  // Group by invoiceId
  const byInvoice = new Map<string, typeof lines>()
  for (const l of lines) {
    const arr = byInvoice.get(l.invoice.id) ?? []
    arr.push(l)
    byInvoice.set(l.invoice.id, arr)
  }

  let invoicesFlagged = 0
  let linesFlagged = 0
  const reasonCounts = new Map<string, number>()
  const sampleByReason = new Map<string, string[]>()

  for (const [invoiceId, invoiceLines] of byInvoice) {
    const inv = invoiceLines[0].invoice
    const liShapes = invoiceLines.map((l) => ({
      lineNumber: l.lineNumber,
      productName: l.productName,
      unit: l.unit,
      packSize: l.packSize,
      unitSize: l.unitSize,
      unitSizeUom: l.unitSizeUom,
      // Required by the type but not used by the check:
      sku: null,
      description: null,
      category: null,
      quantity: 0,
      unitPrice: 0,
      extendedPrice: 0,
    }))
    const anomalies = findPackShapeAnomalies(liShapes)
    if (anomalies.length === 0) continue

    invoicesFlagged++
    linesFlagged += anomalies.length

    for (const a of anomalies) {
      for (const r of a.reasons) {
        // Cluster reasons by their first ~40 chars (drops dynamic numbers)
        const cluster = r.split(/[=:]/)[0].trim().slice(0, 50)
        reasonCounts.set(cluster, (reasonCounts.get(cluster) ?? 0) + 1)
        const samples = sampleByReason.get(cluster) ?? []
        if (samples.length < 5) {
          samples.push(
            `${inv.vendorName} #${inv.invoiceNumber} L${a.lineNumber} "${a.productName.slice(0, 45)}" — ${a.unit} pack=${a.packSize} × size=${a.unitSize} ${a.unitSizeUom}`
          )
          sampleByReason.set(cluster, samples)
        }
      }
    }
  }

  console.log(`\nScanned ${byInvoice.size} invoices, ${lines.length} line items`)
  console.log(`Flagged: ${invoicesFlagged} invoices, ${linesFlagged} lines\n`)
  console.log("Reason breakdown:")
  for (const [cluster, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(4)}× ${cluster}`)
    for (const s of sampleByReason.get(cluster) ?? []) {
      console.log(`         ${s}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
