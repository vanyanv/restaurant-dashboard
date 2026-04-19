// scripts/reprocess-invoices.ts
// Re-extract one or more invoices with the current prompt and persist fresh data
// (including the new packSize / unitSize / unitSizeUom line-item fields). Safer
// replacement for fix-bad-invoices.ts when the goal is broader than the pre-2025
// date bug.
//
// Usage:
//   npx tsx scripts/reprocess-invoices.ts --ids=abc,def           # target rows
//   npx tsx scripts/reprocess-invoices.ts --missing-pack          # rows with CS-unit lines that have packSize=null
//   npx tsx scripts/reprocess-invoices.ts --all                   # every invoice
//   add --apply to persist; default is dry-run.

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

const APPLY = process.argv.includes("--apply")
const ALL = process.argv.includes("--all")
const MISSING_PACK = process.argv.includes("--missing-pack")
const idsArg = process.argv.find((a) => a.startsWith("--ids="))
const TARGET_IDS = idsArg ? idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean) : []

if (!ALL && !MISSING_PACK && TARGET_IDS.length === 0) {
  console.error("Specify --all, --missing-pack, or --ids=<csv>")
  process.exit(2)
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

async function getGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    }
  )
  if (!res.ok) throw new Error(`Token failed: ${await res.text()}`)
  const { access_token } = await res.json()
  return access_token as string
}

async function getPdfAttachment(token: string, messageId: string): Promise<{ name: string; base64: string } | null> {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
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

function fmtDateOnly(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "null"
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log(`║  INVOICE REPROCESS — ${APPLY ? "APPLY MODE (will update DB)" : "DRY RUN (no writes)"}`.padEnd(71) + "║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n")

  const { prisma } = await import("../src/lib/prisma")
  const { extractInvoiceData } = await import("../src/lib/gemini-invoice")
  const { sanitizeInvoiceDate } = await import("../src/lib/invoice-sanity")
  const { matchInvoiceToStore } = await import("../src/lib/address-matcher")

  // ── Select candidates ──
  let whereClause: Record<string, unknown> = {}
  if (TARGET_IDS.length > 0) {
    whereClause = { id: { in: TARGET_IDS } }
  } else if (MISSING_PACK) {
    whereClause = {
      lineItems: {
        some: { unit: "CS", packSize: null },
      },
    }
  }

  const candidates = await prisma.invoice.findMany({
    where: whereClause,
    orderBy: { emailReceivedAt: "asc" },
    select: {
      id: true, ownerId: true, vendorName: true, invoiceNumber: true,
      invoiceDate: true, deliveryAddress: true, storeId: true, status: true,
      emailMessageId: true, emailReceivedAt: true,
      rawExtractionJson: true,
      lineItems: { select: { id: true, unit: true, packSize: true } },
    },
  })
  console.log(`Found ${candidates.length} invoice(s) to reprocess.\n`)
  if (candidates.length === 0) return await prisma.$disconnect()

  // Stores per owner
  const ownerIds = Array.from(new Set(candidates.map((c) => c.ownerId)))
  const allStores = await prisma.store.findMany({
    where: { ownerId: { in: ownerIds }, isActive: true },
    select: { id: true, address: true, name: true, ownerId: true },
  })
  const storesByOwner = new Map<string, typeof allStores>()
  for (const s of allStores) {
    const arr = storesByOwner.get(s.ownerId) ?? []
    arr.push(s)
    storesByOwner.set(s.ownerId, arr)
  }

  const token = await getGraphToken()
  console.log("✓ Microsoft Graph token acquired\n")

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const inv of candidates) {
    console.log(`━━━ ${inv.vendorName} #${inv.invoiceNumber}  [${inv.id}] ━━━`)
    console.log(`  stored date:    ${fmtDateOnly(inv.invoiceDate)}`)
    console.log(`  stored line items: ${inv.lineItems.length} (missing-pack: ${inv.lineItems.filter((l) => l.unit === "CS" && l.packSize == null).length})`)

    if (!inv.emailMessageId) {
      console.log("  ✗ no emailMessageId — skipping\n")
      skipped++
      continue
    }

    const pdf = await getPdfAttachment(token, inv.emailMessageId)
    if (!pdf) {
      console.log("  ✗ PDF attachment missing — skipping\n")
      skipped++
      continue
    }

    let fresh
    let extractionModel: string
    try {
      const result = await extractInvoiceData(pdf.base64, pdf.name)
      fresh = result.extraction
      extractionModel = result.model
    } catch (err) {
      console.log(`  ✗ extraction failed: ${err instanceof Error ? err.message : err}\n`)
      failed++
      continue
    }

    const sanitizedDate = sanitizeInvoiceDate(
      fresh.invoiceDate,
      inv.emailReceivedAt,
      `${inv.vendorName} #${inv.invoiceNumber}`
    )
    const dateSuspect = Boolean(fresh.invoiceDate) && sanitizedDate === null

    const ownerStores = storesByOwner.get(inv.ownerId) ?? []
    const match = fresh.deliveryAddress ? matchInvoiceToStore(fresh.deliveryAddress, ownerStores) : null

    let nextStatus: "MATCHED" | "REVIEW" | "PENDING"
    if (dateSuspect) nextStatus = "REVIEW"
    else if (match) nextStatus = match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
    else nextStatus = "PENDING"

    const missingPackAfter = fresh.lineItems.filter((li) => li.unit === "CS" && li.packSize == null).length
    const withPack = fresh.lineItems.filter((li) => li.packSize != null).length
    console.log(`  model used:     ${extractionModel}`)
    console.log(`  fresh date:     ${fresh.invoiceDate ?? "null"} → sanitized ${fmtDateOnly(sanitizedDate)}`)
    console.log(`  fresh lines:    ${fresh.lineItems.length} total, ${withPack} with pack/size, ${missingPackAfter} CS-without-pack`)
    console.log(`  next status:    ${nextStatus}` + (match ? `  (store ${ownerStores.find((s) => s.id === match.storeId)?.name ?? "?"}, conf ${match.confidence.toFixed(2)})` : ""))

    // Show first 3 line items with pack/size so you can eyeball
    for (const li of fresh.lineItems.slice(0, 3)) {
      const packStr = li.packSize != null && li.unitSize != null
        ? ` ${li.packSize}×${li.unitSize}${li.unitSizeUom ?? ""}`
        : li.packSize != null
        ? ` pack=${li.packSize}`
        : ""
      console.log(`    • qty ${li.quantity} ${li.unit ?? ""}${packStr}  ${li.productName.slice(0, 45)}`)
    }
    if (fresh.lineItems.length > 3) console.log(`    • ...and ${fresh.lineItems.length - 3} more`)

    if (!APPLY) {
      console.log("  (dry run — not updating)\n")
      continue
    }

    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: inv.id } })
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        vendorName: fresh.vendorName ?? inv.vendorName,
        invoiceDate: sanitizedDate,
        dueDate: fresh.dueDate ? new Date(fresh.dueDate) : null,
        deliveryAddress: fresh.deliveryAddress,
        subtotal: fresh.subtotal,
        taxAmount: fresh.taxAmount,
        totalAmount: fresh.totalAmount,
        status: nextStatus,
        storeId: match?.storeId ?? null,
        matchConfidence: match?.confidence ?? null,
        matchedAt: match ? new Date() : null,
        rawExtractionJson: JSON.stringify(fresh),
        extractionModel,
        lineItems: {
          create: fresh.lineItems.map((li) => ({
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
    console.log("  ✓ UPDATED\n")
    updated++
  }

  console.log("━━━ SUMMARY ━━━")
  console.log(`  Candidates: ${candidates.length}`)
  console.log(`  Updated:    ${updated}${APPLY ? "" : "  (dry run — 0 actually written)"}`)
  console.log(`  Skipped:    ${skipped}`)
  console.log(`  Failed:     ${failed}`)
  if (!APPLY) console.log(`\n  Re-run with --apply to persist.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
