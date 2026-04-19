// scripts/backfill-invoice-pdfs.ts
// Re-fetch PDFs from Microsoft Graph for every Invoice row with no pdfBlobPathname
// and upload them to Vercel Blob (access: 'private'). Idempotent — re-running only
// picks up rows still null.
//
// Run with:
//   npx tsx scripts/backfill-invoice-pdfs.ts            # dry run (no uploads, no DB writes)
//   npx tsx scripts/backfill-invoice-pdfs.ts --apply    # actually upload + update DB

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
  messageId: string,
  preferredName: string | null
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

  const pdfs: { name: string; base64: string }[] = []
  for (const a of atts) {
    const name = a.name as string
    const type = a.contentType as string
    if (
      a["@odata.type"] === "#microsoft.graph.fileAttachment" &&
      (type === "application/pdf" ||
        (typeof name === "string" && name.toLowerCase().endsWith(".pdf")))
    ) {
      pdfs.push({ name, base64: a.contentBytes as string })
    }
  }
  if (pdfs.length === 0) return null
  if (preferredName) {
    const exact = pdfs.find((p) => p.name === preferredName)
    if (exact) return exact
  }
  return pdfs[0]
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log(`║  INVOICE PDF BACKFILL — ${APPLY ? "APPLY MODE (will upload + write)" : "DRY RUN (no writes)"}`.padEnd(71) + "║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n")

  const { prisma } = await import("../src/lib/prisma")
  const { putInvoicePdf } = await import("../src/lib/blob")

  const candidates = await prisma.invoice.findMany({
    where: { pdfBlobPathname: null },
    orderBy: { emailReceivedAt: "asc" },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      emailMessageId: true,
      attachmentName: true,
    },
  })

  console.log(`Found ${candidates.length} invoice(s) without a stored PDF.\n`)
  if (candidates.length === 0) {
    await prisma.$disconnect()
    return
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull` first.")
    process.exit(1)
  }

  const token = await getGraphToken()
  console.log("✓ Microsoft Graph token acquired\n")

  let uploaded = 0
  let skipped = 0
  let failed = 0
  const failures: Array<{ id: string; reason: string }> = []

  for (const inv of candidates) {
    console.log(`━━━ ${inv.vendorName} #${inv.invoiceNumber}  [${inv.id}] ━━━`)

    if (!inv.emailMessageId) {
      console.log(`  ✗ no emailMessageId — skipping\n`)
      skipped++
      failures.push({ id: inv.id, reason: "no emailMessageId" })
      continue
    }

    let pdf
    try {
      pdf = await getPdfAttachment(token, inv.emailMessageId, inv.attachmentName)
    } catch (err) {
      console.log(`  ✗ Graph error: ${err instanceof Error ? err.message : err}\n`)
      failed++
      failures.push({ id: inv.id, reason: `graph error: ${err}` })
      continue
    }

    if (!pdf) {
      console.log(`  ✗ original email no longer has PDF attachment — skipping\n`)
      skipped++
      failures.push({ id: inv.id, reason: "no pdf attachment in email" })
      continue
    }

    const buffer = Buffer.from(pdf.base64, "base64")
    console.log(`  ✓ fetched PDF: ${pdf.name} (${buffer.byteLength} bytes)`)

    if (!APPLY) {
      console.log(`  (dry run — skipping upload + DB write)\n`)
      continue
    }

    try {
      const upload = await putInvoicePdf(inv.emailMessageId, buffer)
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          pdfBlobPathname: upload.pathname,
          pdfBlobUrl: upload.url,
          pdfSize: upload.size,
          pdfUploadedAt: upload.uploadedAt,
        },
      })
      console.log(`  ✓ UPLOADED → ${upload.pathname}\n`)
      uploaded++
    } catch (err) {
      console.log(`  ✗ upload failed: ${err instanceof Error ? err.message : err}\n`)
      failed++
      failures.push({ id: inv.id, reason: `upload failed: ${err}` })
    }
  }

  console.log("━━━ SUMMARY ━━━")
  console.log(`  Candidates:  ${candidates.length}`)
  console.log(`  Uploaded:    ${uploaded}${APPLY ? "" : "  (dry run — 0 actually written)"}`)
  console.log(`  Skipped:     ${skipped}  (no emailMessageId / PDF missing from email)`)
  console.log(`  Failed:      ${failed}  (Graph or upload error)`)
  if (!APPLY) {
    console.log(`\n  Re-run with --apply to persist the uploads.`)
  }
  if (failures.length > 0) {
    const outPath = path.resolve(process.cwd(), "backfill-failures.json")
    fs.writeFileSync(outPath, JSON.stringify(failures, null, 2))
    console.log(`\n  Failure details written to ${outPath}`)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
