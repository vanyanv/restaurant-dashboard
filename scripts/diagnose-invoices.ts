// scripts/diagnose-invoices.ts
// Read-only diagnostic for the invoice pipeline.
// Run with: npx tsx scripts/diagnose-invoices.ts
//
// Reports:
//   1. Latest 10 invoices by emailReceivedAt    (what's the newest email we processed?)
//   2. Latest 10 invoices by createdAt          (when did sync actually last write rows?)
//   3. Invoice count by year(invoiceDate)       (how big is the 2023 bug?)
//   4. All invoices with invoiceDate < 2025     (vendor, invoiceDate vs emailReceivedAt, raw extraction)
//   5. Last 5 InvoiceSyncLog rows               (are syncs even running? completing?)

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toISOString().slice(0, 19).replace("T", " ")
}

function fmtDateOnly(d: Date | null | undefined): string {
  if (!d) return "—"
  return new Date(d).toISOString().slice(0, 10)
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…"
  return s.padEnd(n)
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")

  console.log("╔══════════════════════════════════════════════════════════════════════════╗")
  console.log("║  INVOICE PIPELINE DIAGNOSTIC                                             ║")
  console.log(`║  Run at: ${new Date().toISOString().padEnd(62)}║`)
  console.log("╚══════════════════════════════════════════════════════════════════════════╝\n")

  // ─── Total count first for orientation ───
  const totalInvoices = await prisma.invoice.count()
  console.log(`Total invoices in DB: ${totalInvoices}\n`)

  // ═══ Report 1: Latest by emailReceivedAt ═══
  console.log("━━━ 1. LATEST 10 INVOICES BY emailReceivedAt ━━━")
  console.log("(What's the newest invoice-email we've processed? If capped at ~3-25, the mailbox→DB pipeline is flat-lined.)\n")
  const byEmailReceived = await prisma.invoice.findMany({
    orderBy: { emailReceivedAt: "desc" },
    take: 10,
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      emailReceivedAt: true,
      createdAt: true,
      status: true,
    },
  })
  console.log(
    pad("emailReceivedAt", 22) +
    pad("createdAt", 22) +
    pad("invoiceDate", 13) +
    pad("vendor", 24) +
    pad("inv#", 14) +
    "status"
  )
  console.log("─".repeat(110))
  for (const inv of byEmailReceived) {
    console.log(
      pad(fmtDate(inv.emailReceivedAt), 22) +
      pad(fmtDate(inv.createdAt), 22) +
      pad(fmtDateOnly(inv.invoiceDate), 13) +
      pad(inv.vendorName, 24) +
      pad(inv.invoiceNumber, 14) +
      inv.status
    )
  }
  console.log()

  // ═══ Report 2: Latest by createdAt ═══
  console.log("━━━ 2. LATEST 10 INVOICES BY createdAt ━━━")
  console.log("(When did sync actually last WRITE rows? If all cluster around 3-25, sync hasn't run since.)\n")
  const byCreated = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      emailReceivedAt: true,
      createdAt: true,
      status: true,
    },
  })
  console.log(
    pad("createdAt", 22) +
    pad("emailReceivedAt", 22) +
    pad("invoiceDate", 13) +
    pad("vendor", 24) +
    pad("inv#", 14) +
    "status"
  )
  console.log("─".repeat(110))
  for (const inv of byCreated) {
    console.log(
      pad(fmtDate(inv.createdAt), 22) +
      pad(fmtDate(inv.emailReceivedAt), 22) +
      pad(fmtDateOnly(inv.invoiceDate), 13) +
      pad(inv.vendorName, 24) +
      pad(inv.invoiceNumber, 14) +
      inv.status
    )
  }
  console.log()

  // ═══ Report 3: Count by year(invoiceDate) ═══
  console.log("━━━ 3. INVOICE COUNT BY YEAR OF invoiceDate ━━━")
  console.log("(Quantifies the 2023 bug. Anything pre-2025 is almost certainly wrong.)\n")
  const allInvoicesForYears = await prisma.invoice.findMany({
    select: { invoiceDate: true },
  })
  const yearCounts = new Map<string, number>()
  for (const inv of allInvoicesForYears) {
    const year = inv.invoiceDate ? String(new Date(inv.invoiceDate).getUTCFullYear()) : "null"
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1)
  }
  const sortedYears = Array.from(yearCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  for (const [year, count] of sortedYears) {
    const bar = "█".repeat(Math.min(50, count))
    console.log(`  ${year.padEnd(6)} ${String(count).padStart(5)}  ${bar}`)
  }
  console.log()

  // ═══ Report 4: All invoices with invoiceDate < 2025 ═══
  console.log("━━━ 4. ALL INVOICES WITH invoiceDate < 2025-01-01 ━━━")
  console.log("(Compare stored invoiceDate to emailReceivedAt. Email in 2026 + invoice in 2023 = OpenAI is misreading.)\n")
  const badDates = await prisma.invoice.findMany({
    where: { invoiceDate: { lt: new Date("2025-01-01") } },
    orderBy: { invoiceDate: "asc" },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      emailReceivedAt: true,
      emailSubject: true,
      rawExtractionJson: true,
      extractionModel: true,
    },
  })
  console.log(`Found ${badDates.length} invoice(s) with invoiceDate before 2025-01-01\n`)

  for (const inv of badDates) {
    console.log(`  [${inv.id}]`)
    console.log(`    vendor:          ${inv.vendorName}`)
    console.log(`    invoice #:       ${inv.invoiceNumber}`)
    console.log(`    invoiceDate:     ${fmtDateOnly(inv.invoiceDate)}  ← stored`)
    console.log(`    emailReceivedAt: ${fmtDate(inv.emailReceivedAt)}`)
    console.log(`    emailSubject:    ${inv.emailSubject ?? "—"}`)
    console.log(`    extractionModel: ${inv.extractionModel ?? "—"}`)

    // Parse rawExtractionJson to show what OpenAI actually returned
    if (inv.rawExtractionJson) {
      try {
        const raw = JSON.parse(inv.rawExtractionJson)
        console.log(`    raw extraction:`)
        console.log(`      invoiceDate (AI): ${raw.invoiceDate ?? "null"}`)
        console.log(`      dueDate (AI):     ${raw.dueDate ?? "null"}`)
        console.log(`      vendorName (AI):  ${raw.vendorName ?? "—"}`)
      } catch {
        console.log(`    raw extraction:    (failed to parse JSON)`)
      }
    }
    console.log()
  }

  // ═══ Report 5: Last 5 InvoiceSyncLog rows ═══
  console.log("━━━ 5. LAST 5 InvoiceSyncLog ROWS ━━━")
  console.log("(Are syncs even being attempted? Completing? Failing with errors?)\n")
  const syncLogs = await prisma.invoiceSyncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      emailsScanned: true,
      invoicesCreated: true,
      invoicesSkipped: true,
      errors: true,
      errorDetails: true,
      triggeredBy: true,
    },
  })
  console.log(`Found ${syncLogs.length} recent sync log row(s)\n`)
  for (const log of syncLogs) {
    const durationMs =
      log.completedAt && log.startedAt
        ? new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()
        : null
    const duration =
      durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : "INCOMPLETE"

    console.log(`  [${log.id}]`)
    console.log(`    startedAt:       ${fmtDate(log.startedAt)}`)
    console.log(`    completedAt:     ${log.completedAt ? fmtDate(log.completedAt) : "null  ← CRASHED / TIMED OUT"}`)
    console.log(`    duration:        ${duration}`)
    console.log(`    emailsScanned:   ${log.emailsScanned ?? 0}`)
    console.log(`    invoicesCreated: ${log.invoicesCreated ?? 0}`)
    console.log(`    invoicesSkipped: ${log.invoicesSkipped ?? 0}`)
    console.log(`    errors:          ${log.errors ?? 0}`)
    console.log(`    triggeredBy:     ${log.triggeredBy}`)
    if (log.errorDetails) {
      console.log(`    errorDetails:    ${log.errorDetails.slice(0, 200)}`)
    }
    console.log()
  }

  console.log("━━━ DIAGNOSTIC COMPLETE ━━━")
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
