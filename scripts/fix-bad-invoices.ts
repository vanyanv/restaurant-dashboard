// scripts/fix-bad-invoices.ts
// Re-extract invoices that have suspicious stored invoiceDate (pre-2025 or wildly
// off from when the email arrived), update them in place, and print a before/after
// diff for BOTH date and deliveryAddress.
//
// Run with:
//   npx tsx scripts/fix-bad-invoices.ts              # dry run (no DB writes)
//   npx tsx scripts/fix-bad-invoices.ts --apply      # actually update DB rows

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

const APPLY = process.argv.includes("--apply")
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

async function getPdfAttachment(
  token: string,
  messageId: string
): Promise<{ name: string; base64: string } | null> {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    console.warn(`    Graph attachment fetch failed (${res.status})`)
    return null
  }
  const data = await res.json()
  const atts = (data.value ?? []) as Array<Record<string, unknown>>
  for (const a of atts) {
    const name = a.name as string
    const type = a.contentType as string
    if (
      a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
      (type === "application/pdf" ||
        (typeof name === "string" && name.toLowerCase().endsWith(".pdf")))
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
  console.log(`║  INVOICE BACKFILL — ${APPLY ? "APPLY MODE (will update DB)" : "DRY RUN (no writes)"}`.padEnd(71) + "║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n")

  const { prisma } = await import("../src/lib/prisma")
  const { extractInvoiceData } = await import("../src/lib/gemini-invoice")
  const { sanitizeInvoiceDate } = await import("../src/lib/invoice-sanity")
  const { matchInvoiceToStore } = await import("../src/lib/address-matcher")

  // ── Identify candidates ──
  // Any invoice whose invoiceDate is before 2025 OR null-but-AI-returned-something
  // is suspect. We focus on the pre-2025 ones since those are the known bugs.
  const candidates = await prisma.invoice.findMany({
    where: {
      OR: [
        { invoiceDate: { lt: new Date("2025-01-01") } },
        { invoiceDate: null },
      ],
    },
    orderBy: { emailReceivedAt: "asc" },
    select: {
      id: true,
      ownerId: true,
      storeId: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      deliveryAddress: true,
      emailMessageId: true,
      emailReceivedAt: true,
      status: true,
      rawExtractionJson: true,
    },
  })

  console.log(`Found ${candidates.length} candidate invoice(s) to re-extract.\n`)
  if (candidates.length === 0) {
    await prisma.$disconnect()
    return
  }

  // Stores keyed by ownerId so each invoice is matched against its own owner's stores.
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
  console.log(`  ✓ loaded stores for ${storesByOwner.size} owner(s)`)

  const token = await getGraphToken()
  console.log("✓ Microsoft Graph token acquired\n")

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const inv of candidates) {
    console.log(`━━━ ${inv.vendorName} #${inv.invoiceNumber}  [${inv.id}] ━━━`)
    console.log(`  email arrived:    ${inv.emailReceivedAt?.toISOString().slice(0, 10) ?? "—"}`)
    console.log(`  stored date:      ${fmtDateOnly(inv.invoiceDate)}`)
    console.log(`  stored address:   ${inv.deliveryAddress ?? "null"}`)
    console.log(`  stored status:    ${inv.status}`)

    if (!inv.emailMessageId) {
      console.log(`  ✗ no emailMessageId — skipping\n`)
      skipped++
      continue
    }

    const pdf = await getPdfAttachment(token, inv.emailMessageId)
    if (!pdf) {
      console.log(`  ✗ original email no longer has PDF attachment — skipping\n`)
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
    const match = fresh.deliveryAddress
      ? matchInvoiceToStore(fresh.deliveryAddress, ownerStores)
      : null

    let nextStatus: "MATCHED" | "REVIEW" | "PENDING"
    if (dateSuspect) nextStatus = "REVIEW"
    else if (match) nextStatus = match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
    else nextStatus = "PENDING"

    console.log(`  → model used:     ${extractionModel}`)
    console.log(`  → fresh date:     ${fresh.invoiceDate ?? "null"}` + (dateSuspect ? "  ← still suspect, will null + REVIEW" : ""))
    console.log(`  → sanitized:      ${fmtDateOnly(sanitizedDate)}`)
    console.log(`  → fresh address:  ${fresh.deliveryAddress ?? "null"}`)
    if (match) {
      const matchedStore = ownerStores.find((s) => s.id === match.storeId)
      console.log(`  → matched store:  ${matchedStore?.name ?? match.storeId} (confidence ${match.confidence.toFixed(2)})`)
    } else {
      console.log(`  → matched store:  none`)
    }
    console.log(`  → next status:    ${nextStatus}`)

    // Bail if the re-extracted totals look like a different invoice (e.g. multi-invoice PDFs)
    const originalRaw = inv.rawExtractionJson ? JSON.parse(inv.rawExtractionJson) : null
    const origTotal = Number(originalRaw?.totalAmount ?? 0)
    const freshTotal = Number(fresh.totalAmount ?? 0)
    if (origTotal > 0 && freshTotal > 0 && Math.abs(origTotal - freshTotal) / origTotal > 0.05) {
      console.log(
        `  ⚠ totals differ (original $${origTotal} vs fresh $${freshTotal}) — this PDF may contain ` +
        `multiple invoices; forcing REVIEW so you can eyeball it`
      )
      nextStatus = "REVIEW"
    }

    if (!APPLY) {
      console.log(`  (dry run — not updating)\n`)
      continue
    }

    // Also refresh the line items
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
    console.log(`  ✓ UPDATED\n`)
    updated++
  }

  console.log("━━━ SUMMARY ━━━")
  console.log(`  Candidates:  ${candidates.length}`)
  console.log(`  Updated:     ${updated}${APPLY ? "" : "  (dry run — 0 actually written)"}`)
  console.log(`  Skipped:     ${skipped}  (no emailMessageId / PDF missing)`)
  console.log(`  Failed:      ${failed}  (OpenAI error)`)
  if (!APPLY) {
    console.log(`\n  Re-run with --apply to persist the updates.`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
