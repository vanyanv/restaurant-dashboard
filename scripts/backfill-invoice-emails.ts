// scripts/backfill-invoice-emails.ts
// One-off catch-up for the invoice-email sync. The main /api/invoices/sync route
// uses a 7-day rolling lookback once any successful sync exists, so emails that
// arrive during a longer outage get silently orphaned. This script fetches with
// a configurable lookback window, dedupes against existing Invoice rows, and
// runs the missing messages through the normal extraction + write pipeline.
//
// Usage:
//   DAYS=60 npx tsx scripts/backfill-invoice-emails.ts           # dry run
//   DAYS=60 APPLY=1 npx tsx scripts/backfill-invoice-emails.ts   # actually ingest

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

import { prisma } from "../src/lib/prisma"
import { fetchInvoiceEmails, getEmailAttachments } from "../src/lib/microsoft-graph"
import { extractInvoiceData } from "../src/lib/gemini-invoice"
import { matchInvoiceToStore } from "../src/lib/address-matcher"
import { sanitizeInvoiceDate } from "../src/lib/invoice-sanity"
import { putInvoicePdf } from "../src/lib/blob"
import { normalizeVendorName } from "../src/lib/vendor-normalize"
import { matchNewLineItems } from "../src/lib/ingredient-matching"

const DAYS = Number(process.env.DAYS ?? "60")
const APPLY = process.env.APPLY === "1"

const SKIP_PATTERNS = [
  "weekly statement",
  "order confirmation",
  "tracking",
  "delivery notification",
]

async function main() {
  if (!Number.isFinite(DAYS) || DAYS <= 0) {
    console.error(`Invalid DAYS=${process.env.DAYS}`)
    process.exit(2)
  }

  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } })
  if (!owner) {
    console.error("No OWNER user found")
    process.exit(1)
  }

  const since = new Date()
  since.setDate(since.getDate() - DAYS)
  console.log(
    `Lookback = ${DAYS} days → since ${since.toISOString()}` +
    `   mode = ${APPLY ? "APPLY" : "DRY-RUN"}   owner = ${owner.email}`
  )

  const all = await fetchInvoiceEmails(since)
  const messages = all.filter((m) => {
    const subj = (m.subject ?? "").toLowerCase()
    return !SKIP_PATTERNS.some((p) => subj.includes(p))
  })
  console.log(`Graph returned ${all.length} messages with attachments; ${messages.length} after subject filter`)

  const existing = await prisma.invoice.findMany({
    where: { emailMessageId: { in: messages.map((m) => m.id) } },
    select: { emailMessageId: true },
  })
  const seen = new Set(existing.map((e) => e.emailMessageId))
  const missing = messages.filter((m) => !seen.has(m.id))

  console.log(`Already ingested: ${existing.length}`)
  console.log(`Missing (to process): ${missing.length}`)
  for (const m of missing) {
    const fromAddr = m.from?.emailAddress?.address ?? "?"
    console.log(`  - ${m.receivedDateTime} | from=${fromAddr} | "${m.subject ?? ""}"`)
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — re-run with APPLY=1 to ingest these.")
    await prisma.$disconnect()
    return
  }

  if (missing.length === 0) {
    console.log("Nothing to ingest.")
    await prisma.$disconnect()
    return
  }

  const stores = await prisma.store.findMany({
    where: { ownerId: owner.id, isActive: true },
    select: { id: true, address: true },
  })

  const createdIds: string[] = []
  let errors = 0

  for (const msg of missing) {
    const label = `"${msg.subject ?? ""}" (${msg.receivedDateTime})`
    try {
      const attachments = await getEmailAttachments(msg.id)
      if (attachments.length === 0) {
        console.log(`  skip — no PDF attachment: ${label}`)
        continue
      }

      const pdf = attachments[0]
      const { extraction, model } = await extractInvoiceData(pdf.contentBytes, pdf.name)

      let pdfUpload: Awaited<ReturnType<typeof putInvoicePdf>> | null = null
      try {
        const buffer = Buffer.from(pdf.contentBytes, "base64")
        pdfUpload = await putInvoicePdf(msg.id, buffer)
      } catch (e) {
        console.warn(`  blob upload failed for ${label}: ${(e as Error).message}`)
      }

      const emailReceivedAt = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null
      const contextLabel = `${extraction.vendorName} #${extraction.invoiceNumber}`
      const invoiceDate = sanitizeInvoiceDate(extraction.invoiceDate, emailReceivedAt, contextLabel)
      const dateSuspect = Boolean(extraction.invoiceDate) && invoiceDate === null

      const match = extraction.deliveryAddress
        ? matchInvoiceToStore(extraction.deliveryAddress, stores)
        : null

      let status: "MATCHED" | "REVIEW" | "PENDING"
      if (dateSuspect) status = "REVIEW"
      else if (match) status = match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
      else status = "PENDING"

      const created = await prisma.invoice.create({
        data: {
          ownerId: owner.id,
          storeId: match?.storeId ?? null,
          emailMessageId: msg.id,
          emailSubject: msg.subject,
          emailReceivedAt,
          attachmentName: pdf.name,
          vendorName: normalizeVendorName(extraction.vendorName),
          invoiceNumber: extraction.invoiceNumber,
          invoiceDate,
          dueDate: extraction.dueDate ? new Date(extraction.dueDate) : null,
          deliveryAddress: extraction.deliveryAddress,
          subtotal: extraction.subtotal,
          taxAmount: extraction.taxAmount,
          totalAmount: extraction.totalAmount,
          status,
          matchConfidence: match?.confidence ?? null,
          matchedAt: match ? new Date() : null,
          rawExtractionJson: JSON.stringify(extraction),
          extractionModel: model,
          pdfBlobPathname: pdfUpload?.pathname ?? null,
          pdfBlobUrl: pdfUpload?.url ?? null,
          pdfSize: pdfUpload?.size ?? null,
          pdfUploadedAt: pdfUpload?.uploadedAt ?? null,
          lineItems: {
            create: extraction.lineItems.map((li) => ({
              lineNumber: li.lineNumber,
              sku: li.sku,
              productName: li.productName,
              description: li.description,
              category: li.category,
              quantity: li.quantity,
              unit: li.unit,
              packSize: li.packSize,
              unitSize: li.unitSize,
              unitSizeUom: li.unitSizeUom,
              unitPrice: li.unitPrice,
              extendedPrice: li.extendedPrice,
            })),
          },
        },
      })
      createdIds.push(created.id)
      console.log(`  ingested ${label} → ${extraction.vendorName} #${extraction.invoiceNumber} [${status}]`)
    } catch (e) {
      errors++
      const msgTxt = e instanceof Error ? e.message : String(e)
      if (msgTxt.includes("Unique constraint")) {
        console.log(`  already exists (race): ${label}`)
      } else {
        console.error(`  FAILED ${label}: ${msgTxt}`)
      }
    }
  }

  if (createdIds.length > 0) {
    try {
      const res = await matchNewLineItems(owner.id, createdIds)
      console.log(
        `\nIngredient match: sku=${res.matchedBySku} alias=${res.matchedByAlias} ` +
        `unmatched=${res.unmatched} costsUpdated=${res.costsUpdated}`
      )
    } catch (e) {
      console.error("matchNewLineItems failed:", (e as Error).message)
    }
  }

  console.log(`\nDone. created=${createdIds.length} errors=${errors}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
