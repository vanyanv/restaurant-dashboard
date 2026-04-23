// Diagnose the home (≈$80K) vs Invoices page (≈$77K) discrepancy.
//
// Reproduces both queries end-to-end, shows what each one sums, and isolates
// the window of invoices that appears in one but not the other.

import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

function money(n: number): string { return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` }

function homeWindow(days = 30) {
  // New: calendar-aligned window (post-fix).
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return { gte: start, lte: end }
}

function invoicesPageWindow() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  const start = new Date(today)
  start.setDate(start.getDate() - 29)
  const gte = new Date(`${toIso(start)}T00:00:00`)
  const lte = new Date(`${toIso(end)}T23:59:59.999`)
  return { gte, lte }
}

function toIso(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  const owners = await prisma.invoice.groupBy({ by: ["ownerId"], _count: { _all: true } })
  if (owners.length === 0) {
    console.log("No invoices in DB.")
    await prisma.$disconnect()
    return
  }

  for (const o of owners) {
    console.log(`\n=== Owner ${o.ownerId}  (${o._count._all} invoices) ===`)
    const home = homeWindow(30)
    const ipg = invoicesPageWindow()

    console.log(`home window     : gte=${home.gte.toISOString()}  lte=${home.lte ? home.lte.toISOString() : "NONE"}`)
    console.log(`invoices window : gte=${ipg.gte.toISOString()}  lte=${ipg.lte.toISOString()}`)

    const homeInvoices = await prisma.invoice.findMany({
      where: {
        ownerId: o.ownerId,
        invoiceDate: home.lte ? { gte: home.gte, lte: home.lte } : { gte: home.gte },
      },
      select: { id: true, totalAmount: true, invoiceDate: true, vendorName: true, invoiceNumber: true, status: true },
      orderBy: { invoiceDate: "asc" },
    })
    const ipgInvoices = await prisma.invoice.findMany({
      where: { ownerId: o.ownerId, invoiceDate: { gte: ipg.gte, lte: ipg.lte } },
      select: { id: true, totalAmount: true, invoiceDate: true, vendorName: true, invoiceNumber: true, status: true },
      orderBy: { invoiceDate: "asc" },
    })

    const homeTotal = homeInvoices.reduce((s, i) => s + i.totalAmount, 0)
    const ipgTotal = ipgInvoices.reduce((s, i) => s + i.totalAmount, 0)

    console.log(`\nhome     : ${homeInvoices.length} invoices, ${money(homeTotal)}`)
    console.log(`invoices : ${ipgInvoices.length} invoices, ${money(ipgTotal)}`)
    console.log(`delta    : ${homeInvoices.length - ipgInvoices.length} invoices, ${money(homeTotal - ipgTotal)}`)

    // Invoices in home but not in invoices page (the leftover window).
    const ipgIds = new Set(ipgInvoices.map((i) => i.id))
    const onlyHome = homeInvoices.filter((i) => !ipgIds.has(i.id))
    console.log(`\nIn HOME but NOT in INVOICES PAGE: ${onlyHome.length} invoices, ${money(onlyHome.reduce((s, i) => s + i.totalAmount, 0))}`)
    for (const i of onlyHome) {
      console.log(`  ${i.invoiceDate?.toISOString() ?? "null"}  ${i.vendorName.padEnd(36).slice(0, 36)}  ${i.invoiceNumber.padEnd(20).slice(0, 20)}  ${money(i.totalAmount).padStart(12)}  [${i.status}]`)
    }

    // And the reverse (should be empty)
    const homeIds = new Set(homeInvoices.map((i) => i.id))
    const onlyIpg = ipgInvoices.filter((i) => !homeIds.has(i.id))
    if (onlyIpg.length > 0) {
      console.log(`\nIn INVOICES PAGE but NOT in HOME: ${onlyIpg.length} invoices, ${money(onlyIpg.reduce((s, i) => s + i.totalAmount, 0))}`)
      for (const i of onlyIpg) {
        console.log(`  ${i.invoiceDate?.toISOString() ?? "null"}  ${i.vendorName.padEnd(36).slice(0, 36)}  ${i.invoiceNumber.padEnd(20).slice(0, 20)}  ${money(i.totalAmount).padStart(12)}  [${i.status}]`)
      }
    }

    // Bad data — future-dated invoices
    const now = new Date()
    const future = await prisma.invoice.findMany({
      where: { ownerId: o.ownerId, invoiceDate: { gt: now } },
      select: { invoiceDate: true, vendorName: true, invoiceNumber: true, totalAmount: true, status: true },
      orderBy: { invoiceDate: "asc" },
    })
    if (future.length > 0) {
      console.log(`\nFUTURE-DATED invoices (inflating home): ${future.length}, ${money(future.reduce((s, i) => s + i.totalAmount, 0))}`)
      for (const i of future) {
        console.log(`  ${i.invoiceDate?.toISOString()}  ${i.vendorName.slice(0, 36).padEnd(36)}  ${i.invoiceNumber.slice(0, 20).padEnd(20)}  ${money(i.totalAmount).padStart(12)}  [${i.status}]`)
      }
    } else {
      console.log(`\nNo future-dated invoices.`)
    }

    // Null invoiceDate — also a possible gotcha
    const nulls = await prisma.invoice.count({
      where: { ownerId: o.ownerId, invoiceDate: null },
    })
    console.log(`Invoices with null invoiceDate (excluded by both): ${nulls}`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
