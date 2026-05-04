// Fetches the PDF attachment for an invoice and saves it to /tmp so we can
// inspect it directly with the Read tool.

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

const INVOICE_ID = process.argv[2]
const OUT_PATH = process.argv[3] ?? `/tmp/invoice-${INVOICE_ID}.pdf`
if (!INVOICE_ID) {
  console.error("Usage: tsx tmp/fetch-pdf.ts <invoiceId> [outputPath]")
  process.exit(2)
}

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

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const inv = await prisma.invoice.findUnique({
    where: { id: INVOICE_ID },
    select: { vendorName: true, invoiceNumber: true, emailMessageId: true },
  })
  if (!inv?.emailMessageId) {
    console.error("Invoice or emailMessageId not found")
    process.exit(1)
  }
  const token = await getGraphToken()
  const userId = process.env.MICROSOFT_MAIL_USER_ID!
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/messages/${inv.emailMessageId}/attachments`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    console.error(`Graph error: ${await res.text()}`)
    process.exit(1)
  }
  const data = await res.json()
  for (const a of data.value ?? []) {
    if (a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentType === "application/pdf") {
      fs.writeFileSync(OUT_PATH, Buffer.from(a.contentBytes, "base64"))
      console.log(`Saved ${inv.vendorName} #${inv.invoiceNumber} to ${OUT_PATH}`)
      console.log(`Size: ${fs.statSync(OUT_PATH).size} bytes`)
      await prisma.$disconnect()
      return
    }
  }
  console.error("No PDF attachment found")
  await prisma.$disconnect()
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
