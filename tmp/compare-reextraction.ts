// Compare stored lineItems vs fresh re-extraction for a list of invoice IDs.
// Read-only — does NOT write to DB. Outputs a structured markdown report so
// we can audit every changed line before running reprocess --apply.
//
// Usage:
//   ./node_modules/.bin/tsx tmp/compare-reextraction.ts <id1,id2,...>
//   ./node_modules/.bin/tsx tmp/compare-reextraction.ts --flagged   # all 49
// Output: writes to tmp/compare-report.md, also tails to stdout.

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

const FLAGGED_MODE = process.argv.includes("--flagged")
const idsArg = process.argv.find((a) => !a.startsWith("--") && a.startsWith("cm"))
const TARGET_IDS = idsArg ? idsArg.split(",") : []
const CONCURRENCY = 3

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

async function getPdf(token: string, messageId: string): Promise<{ name: string; base64: string } | null> {
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${messageId}/attachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json()
  for (const a of data.value ?? []) {
    if (a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentType === "application/pdf") {
      return { name: a.name as string, base64: a.contentBytes as string }
    }
  }
  return null
}

interface LineSnap {
  lineNumber: number
  sku: string | null
  productName: string
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  quantity: number
  unitPrice: number
  extendedPrice: number
}

function packStr(l: { packSize: number | null; unitSize: number | null; unitSizeUom: string | null }): string {
  return `${l.packSize ?? "-"}×${l.unitSize ?? "-"} ${l.unitSizeUom ?? "-"}`
}

interface InvoiceCompareResult {
  id: string
  vendor: string
  invNum: string
  date: string
  oldTotal: number
  newTotal: number
  oldLineCount: number
  newLineCount: number
  changedLines: Array<{ sku: string | null; productName: string; oldPack: string; newPack: string; oldExt: number; newExt: number }>
  newAnomalies: Array<{ lineNumber: number; productName: string; reasons: string[] }>
  newMathMismatches: Array<{ lineNumber: number; productName: string }>
  error: string | null
}

async function compareOne(invoiceId: string, token: string): Promise<InvoiceCompareResult> {
  const { prisma } = await import("../src/lib/prisma")
  const { extractInvoiceData } = await import("../src/lib/gemini-invoice")
  const { findPackShapeAnomalies, findLineMathMismatches } = await import("../src/lib/invoice-sanity")

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      vendorName: true, invoiceNumber: true, invoiceDate: true,
      totalAmount: true, emailMessageId: true,
      lineItems: {
        orderBy: { lineNumber: "asc" },
        select: {
          lineNumber: true, sku: true, productName: true, unit: true,
          packSize: true, unitSize: true, unitSizeUom: true,
          quantity: true, unitPrice: true, extendedPrice: true,
        },
      },
    },
  })
  if (!inv) return { id: invoiceId, vendor: "?", invNum: "?", date: "?", oldTotal: 0, newTotal: 0, oldLineCount: 0, newLineCount: 0, changedLines: [], newAnomalies: [], newMathMismatches: [], error: "invoice not found" }

  if (!inv.emailMessageId) {
    return { id: invoiceId, vendor: inv.vendorName, invNum: inv.invoiceNumber, date: inv.invoiceDate?.toISOString().slice(0,10) ?? "—", oldTotal: inv.totalAmount, newTotal: 0, oldLineCount: inv.lineItems.length, newLineCount: 0, changedLines: [], newAnomalies: [], newMathMismatches: [], error: "no emailMessageId" }
  }

  const pdf = await getPdf(token, inv.emailMessageId)
  if (!pdf) return { id: invoiceId, vendor: inv.vendorName, invNum: inv.invoiceNumber, date: inv.invoiceDate?.toISOString().slice(0,10) ?? "—", oldTotal: inv.totalAmount, newTotal: 0, oldLineCount: inv.lineItems.length, newLineCount: 0, changedLines: [], newAnomalies: [], newMathMismatches: [], error: "PDF not found in mailbox" }

  let extraction
  try {
    const r = await extractInvoiceData(pdf.base64, pdf.name)
    extraction = r.extraction
  } catch (e) {
    return { id: invoiceId, vendor: inv.vendorName, invNum: inv.invoiceNumber, date: inv.invoiceDate?.toISOString().slice(0,10) ?? "—", oldTotal: inv.totalAmount, newTotal: 0, oldLineCount: inv.lineItems.length, newLineCount: 0, changedLines: [], newAnomalies: [], newMathMismatches: [], error: `extraction failed: ${e instanceof Error ? e.message.slice(0,80) : e}` }
  }

  // Match by SKU first, then by lineNumber as fallback
  const oldByKey = new Map<string, LineSnap>()
  for (const o of inv.lineItems) {
    const key = o.sku ? `sku:${o.sku}` : `n:${o.lineNumber}`
    oldByKey.set(key, o as LineSnap)
  }

  const changed: InvoiceCompareResult["changedLines"] = []
  for (const n of extraction.lineItems) {
    const key = n.sku ? `sku:${n.sku}` : `n:${n.lineNumber}`
    const o = oldByKey.get(key)
    if (!o) {
      changed.push({ sku: n.sku, productName: (n.productName ?? "(no name)").slice(0, 40), oldPack: "(new line)", newPack: packStr(n), oldExt: 0, newExt: n.extendedPrice })
      continue
    }
    const oldP = packStr(o), newP = packStr(n)
    if (oldP !== newP || Math.abs(o.extendedPrice - n.extendedPrice) > 0.01) {
      changed.push({ sku: n.sku, productName: (n.productName ?? "(no name)").slice(0, 40), oldPack: oldP, newPack: newP, oldExt: o.extendedPrice, newExt: n.extendedPrice })
    }
  }
  // Lines that vanished
  const newKeys = new Set(extraction.lineItems.map((n) => n.sku ? `sku:${n.sku}` : `n:${n.lineNumber}`))
  for (const [key, o] of oldByKey) {
    if (!newKeys.has(key)) {
      changed.push({ sku: o.sku, productName: (o.productName ?? "(no name)").slice(0, 40), oldPack: packStr(o), newPack: "(dropped)", oldExt: o.extendedPrice, newExt: 0 })
    }
  }

  const anomalies = findPackShapeAnomalies(extraction.lineItems).map((a) => ({ lineNumber: a.lineNumber, productName: a.productName, reasons: a.reasons }))
  const maths = findLineMathMismatches(extraction.lineItems).map((m) => ({ lineNumber: m.lineNumber, productName: m.productName }))

  return {
    id: invoiceId, vendor: inv.vendorName, invNum: inv.invoiceNumber,
    date: inv.invoiceDate?.toISOString().slice(0,10) ?? "—",
    oldTotal: inv.totalAmount, newTotal: extraction.totalAmount,
    oldLineCount: inv.lineItems.length, newLineCount: extraction.lineItems.length,
    changedLines: changed,
    newAnomalies: anomalies,
    newMathMismatches: maths,
    error: null,
  }
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { findPackShapeAnomalies } = await import("../src/lib/invoice-sanity")

  let ids: string[] = TARGET_IDS
  if (FLAGGED_MODE) {
    const lines = await prisma.invoiceLineItem.findMany({
      select: {
        lineNumber: true, productName: true, unit: true, packSize: true, unitSize: true, unitSizeUom: true,
        invoice: { select: { id: true, invoiceDate: true } },
      },
    })
    const byInv = new Map<string, typeof lines>()
    for (const l of lines) {
      const a = byInv.get(l.invoice.id) ?? []
      a.push(l); byInv.set(l.invoice.id, a)
    }
    const flagged: { id: string; date: string }[] = []
    for (const [id, ls] of byInv) {
      const liShapes = ls.map((l) => ({
        lineNumber: l.lineNumber, productName: l.productName, unit: l.unit,
        packSize: l.packSize, unitSize: l.unitSize, unitSizeUom: l.unitSizeUom,
        sku: null, description: null, category: null,
        quantity: 0, unitPrice: 0, extendedPrice: 0,
      }))
      if (findPackShapeAnomalies(liShapes).length > 0) {
        flagged.push({ id, date: ls[0].invoice.invoiceDate?.toISOString() ?? "" })
      }
    }
    flagged.sort((a, b) => a.date.localeCompare(b.date))
    ids = flagged.map((f) => f.id)
    console.log(`Loaded ${ids.length} flagged invoices`)
  }
  if (ids.length === 0) {
    console.error("No invoice IDs provided. Use --flagged or pass comma-separated IDs.")
    process.exit(2)
  }

  const token = await getGraphToken()
  console.log(`✓ Graph token acquired. Running ${ids.length} extractions @ concurrency ${CONCURRENCY}\n`)

  const results: InvoiceCompareResult[] = []
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY)
    const r = await Promise.all(batch.map((id) => compareOne(id, token)))
    results.push(...r)
    process.stderr.write(`  processed ${results.length}/${ids.length}\n`)
  }

  // Build markdown report
  const md: string[] = []
  md.push(`# Re-extraction comparison report — ${new Date().toISOString()}`)
  md.push(`Compared ${results.length} invoices.\n`)

  const errors = results.filter((r) => r.error)
  const totalDrift = results.filter((r) => !r.error && Math.abs(r.oldTotal - r.newTotal) > 0.5)
  const lineCountChanged = results.filter((r) => !r.error && r.oldLineCount !== r.newLineCount)
  const stillFlagged = results.filter((r) => !r.error && r.newAnomalies.length > 0)
  const newMath = results.filter((r) => !r.error && r.newMathMismatches.length > 0)

  md.push(`## Summary`)
  md.push(`- ✗ Errors: ${errors.length}`)
  md.push(`- ⚠ Total amount drift > $0.50: ${totalDrift.length}`)
  md.push(`- ⚠ Line count changed: ${lineCountChanged.length}`)
  md.push(`- ⚠ Still has pack-shape anomalies after re-extract: ${stillFlagged.length}`)
  md.push(`- ⚠ Has math mismatches after re-extract: ${newMath.length}\n`)

  for (const r of results) {
    md.push(`## ${r.vendor} #${r.invNum} (${r.date})`)
    md.push(`- ID: \`${r.id}\``)
    if (r.error) {
      md.push(`- ✗ **ERROR**: ${r.error}`)
      md.push("")
      continue
    }
    md.push(`- old total $${r.oldTotal.toFixed(2)} → new total $${r.newTotal.toFixed(2)} (drift $${(r.newTotal - r.oldTotal).toFixed(2)})`)
    md.push(`- old lines ${r.oldLineCount} → new lines ${r.newLineCount}`)
    md.push(`- changed lines: ${r.changedLines.length}`)
    if (r.changedLines.length > 0) {
      md.push("")
      md.push(`| SKU | Product | Old | New | Old ext | New ext |`)
      md.push(`|---|---|---|---|---|---|`)
      for (const c of r.changedLines) {
        md.push(`| ${c.sku ?? "-"} | ${c.productName} | \`${c.oldPack}\` | \`${c.newPack}\` | $${c.oldExt.toFixed(2)} | $${c.newExt.toFixed(2)} |`)
      }
    }
    if (r.newAnomalies.length > 0) {
      md.push(`- ⚠ post-extract pack anomalies: ${r.newAnomalies.length}`)
      for (const a of r.newAnomalies) md.push(`  - L${a.lineNumber} "${a.productName}": ${a.reasons.join("; ")}`)
    }
    if (r.newMathMismatches.length > 0) {
      md.push(`- ⚠ post-extract math mismatches: ${r.newMathMismatches.length}`)
      for (const m of r.newMathMismatches) md.push(`  - L${m.lineNumber} "${m.productName}"`)
    }
    md.push("")
  }

  fs.writeFileSync("tmp/compare-report.md", md.join("\n"))
  console.log(`\n✓ Wrote tmp/compare-report.md (${md.length} lines)`)
  console.log(`\nQuick summary:`)
  console.log(`  errors:           ${errors.length}`)
  console.log(`  total drift:      ${totalDrift.length}`)
  console.log(`  line count chg:   ${lineCountChanged.length}`)
  console.log(`  still anomalous:  ${stillFlagged.length}`)
  console.log(`  math mismatches:  ${newMath.length}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
