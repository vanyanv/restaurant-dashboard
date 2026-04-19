// scripts/inspect-bad-invoice.ts
// Re-extract a specific known-bad invoice to see whether OpenAI is at fault.
// Also probes the invoices@ mailbox for recent activity since 2026-03-30.
// Run with: npx tsx scripts/inspect-bad-invoice.ts

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

const TARGET_INVOICE = "2232461"
const TARGET_VENDOR_FRAGMENT = "Premier"
const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

async function getGraphToken(): Promise<string> {
  const tenantId = process.env.MICROSOFT_TENANT_ID!
  const clientId = process.env.MICROSOFT_CLIENT_ID!
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    }
  )
  if (!res.ok) throw new Error(`Token request failed: ${await res.text()}`)
  const data = await res.json()
  return data.access_token as string
}

async function probeRecentEmails(token: string): Promise<void> {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  // Explicit orderby=receivedDateTime desc so we actually see the latest
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages` +
    `?$filter=hasAttachments eq true` +
    `&$orderby=receivedDateTime desc` +
    `&$select=id,subject,receivedDateTime,from,hasAttachments` +
    `&$top=20`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.log(`  ✗ Graph query failed (${res.status}): ${await res.text()}`)
    return
  }
  const data = await res.json()
  const messages = (data.value ?? []) as Array<{
    id: string
    subject: string | null
    receivedDateTime: string
    from?: { emailAddress?: { address?: string } }
  }>

  console.log(`Found ${messages.length} most-recent emails with attachments (orderby desc):\n`)
  for (const msg of messages.slice(0, 20)) {
    const from = msg.from?.emailAddress?.address ?? "unknown"
    console.log(`  ${msg.receivedDateTime.slice(0, 19).replace("T", " ")}  ${from.padEnd(36)}  ${msg.subject?.slice(0, 70) ?? "(no subject)"}`)
  }

  // Count how many arrived since 2026-03-30
  const since = new Date("2026-03-30T00:00:00Z")
  const recentCount = messages.filter((m) => new Date(m.receivedDateTime) >= since).length
  console.log(
    `\n→ ${recentCount} of these arrived on or after 2026-03-30. ` +
    (recentCount === 0
      ? "Top 20 are all older — either vendors stopped emailing OR Graph order is weird. Fetching deeper…"
      : "Vendors ARE still emailing. Sync pipeline is broken somewhere downstream.")
  )
}

async function getPdfAttachment(token: string, messageId: string): Promise<{ name: string; base64: string } | null> {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Attachment fetch failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const atts = (data.value ?? []) as Array<Record<string, unknown>>
  for (const a of atts) {
    const name = a.name as string
    const type = a.contentType as string
    if (
      a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
      (type === "application/pdf" || (typeof name === "string" && name.toLowerCase().endsWith(".pdf")))
    ) {
      return { name, base64: a.contentBytes as string }
    }
  }
  return null
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════════╗")
  console.log("║  INVOICE RE-EXTRACTION TEST                                              ║")
  console.log(`║  Target: Premier Meats & Crystal Bay invoice #${TARGET_INVOICE}                      ║`)
  console.log("╚══════════════════════════════════════════════════════════════════════════╝\n")

  // ── Step 1: Look up the DB row ──
  const { prisma } = await import("../src/lib/prisma")
  const invoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: TARGET_INVOICE,
      vendorName: { contains: TARGET_VENDOR_FRAGMENT },
    },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      emailMessageId: true,
      emailSubject: true,
      emailReceivedAt: true,
      attachmentName: true,
      totalAmount: true,
      rawExtractionJson: true,
      extractionModel: true,
    },
  })

  if (!invoice) {
    console.error(`No invoice found with invoiceNumber=${TARGET_INVOICE} and vendor containing "${TARGET_VENDOR_FRAGMENT}"`)
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log("━━━ STORED DB ROW ━━━")
  console.log(`  id:              ${invoice.id}`)
  console.log(`  vendor:          ${invoice.vendorName}`)
  console.log(`  invoice #:       ${invoice.invoiceNumber}`)
  console.log(`  invoiceDate:     ${invoice.invoiceDate?.toISOString().slice(0, 10) ?? "—"}  ← stored`)
  console.log(`  dueDate:         ${invoice.dueDate?.toISOString().slice(0, 10) ?? "—"}`)
  console.log(`  emailReceivedAt: ${invoice.emailReceivedAt?.toISOString() ?? "—"}`)
  console.log(`  emailSubject:    ${invoice.emailSubject ?? "—"}`)
  console.log(`  attachmentName:  ${invoice.attachmentName ?? "—"}`)
  console.log(`  totalAmount:     $${invoice.totalAmount?.toFixed(2) ?? "—"}`)
  console.log(`  extractionModel: ${invoice.extractionModel ?? "—"}`)
  console.log()

  console.log("━━━ ORIGINAL OpenAI EXTRACTION (from rawExtractionJson) ━━━")
  if (invoice.rawExtractionJson) {
    const raw = JSON.parse(invoice.rawExtractionJson)
    console.log(`  invoiceDate:  ${raw.invoiceDate ?? "null"}`)
    console.log(`  dueDate:      ${raw.dueDate ?? "null"}`)
    console.log(`  vendorName:   ${raw.vendorName}`)
    console.log(`  totalAmount:  $${raw.totalAmount}`)
    console.log(`  lineItems:    ${raw.lineItems?.length ?? 0} items`)
  }
  console.log()

  if (!invoice.emailMessageId) {
    console.error("No emailMessageId on this row — can't re-fetch PDF.")
    await prisma.$disconnect()
    process.exit(1)
  }

  // ── Step 2: Re-fetch the PDF from Microsoft Graph ──
  console.log("━━━ FETCHING PDF FROM OUTLOOK ━━━")
  const token = await getGraphToken()
  console.log("  ✓ Graph token acquired")

  const pdf = await getPdfAttachment(token, invoice.emailMessageId)
  if (!pdf) {
    console.error("  ✗ No PDF attachment found on the original email. Email may have been deleted.")
    await prisma.$disconnect()
    process.exit(1)
  }

  const outDir = path.resolve(process.cwd(), "scripts/test-output")
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const pdfPath = path.join(outDir, `premier-${TARGET_INVOICE}.pdf`)
  fs.writeFileSync(pdfPath, Buffer.from(pdf.base64, "base64"))
  console.log(`  ✓ PDF saved: ${pdfPath} (${(pdf.base64.length / 1024).toFixed(0)}KB base64)\n`)

  // ── Step 3: Re-run OpenAI extraction ──
  console.log("━━━ FRESH OpenAI EXTRACTION (re-running extractInvoiceData) ━━━")
  const { extractInvoiceData } = await import("../src/lib/gemini-invoice")
  const start = Date.now()
  const fresh = await extractInvoiceData(pdf.base64, pdf.name)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`  ✓ OpenAI responded in ${elapsed}s\n`)
  console.log(`  invoiceDate:  ${fresh.invoiceDate ?? "null"}`)
  console.log(`  dueDate:      ${fresh.dueDate ?? "null"}`)
  console.log(`  vendorName:   ${fresh.vendorName}`)
  console.log(`  totalAmount:  $${fresh.totalAmount}`)
  console.log(`  lineItems:    ${fresh.lineItems?.length ?? 0} items`)
  console.log()

  // ── Step 4: Side-by-side comparison ──
  const originalRaw = invoice.rawExtractionJson ? JSON.parse(invoice.rawExtractionJson) : {}
  console.log("━━━ SIDE-BY-SIDE ━━━")
  console.log(`  email arrived:          ${invoice.emailReceivedAt?.toISOString().slice(0, 10) ?? "—"}`)
  console.log(`  stored invoiceDate:     ${invoice.invoiceDate?.toISOString().slice(0, 10) ?? "—"}`)
  console.log(`  original OpenAI result: ${originalRaw.invoiceDate ?? "null"}`)
  console.log(`  fresh OpenAI result:    ${fresh.invoiceDate ?? "null"}`)
  console.log()
  console.log(`  → PDF saved to ${pdfPath} — open it and check what date is actually printed.`)
  console.log()

  // ── Bonus: probe recent mailbox activity to explain the stale sync ──
  console.log("━━━ BONUS: RECENT MAILBOX ACTIVITY (invoices@chrisneddys.com) ━━━")
  console.log("(Are new invoice emails actually arriving? Syncs since 2026-03-29 all reported 0 emails scanned.)\n")
  await probeRecentEmails(token)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
