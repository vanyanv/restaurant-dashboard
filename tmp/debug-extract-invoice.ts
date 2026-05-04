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

const TARGET_ID = process.argv[2]
if (!TARGET_ID) {
  console.error("Usage: tsx tmp/debug-extract-invoice.ts <invoiceId>")
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

async function getPdfAttachment(token: string, messageId: string) {
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

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const { extractInvoiceData } = await import("../src/lib/gemini-invoice")

  const inv = await prisma.invoice.findUnique({
    where: { id: TARGET_ID },
    select: { id: true, vendorName: true, invoiceNumber: true, emailMessageId: true },
  })
  if (!inv) {
    console.error(`Invoice ${TARGET_ID} not found`)
    process.exit(1)
  }
  console.log(`Re-extracting ${inv.vendorName} #${inv.invoiceNumber} (${inv.id})\n`)

  const token = await getGraphToken()
  const pdf = await getPdfAttachment(token, inv.emailMessageId!)
  if (!pdf) {
    console.error("PDF attachment not found")
    process.exit(1)
  }

  const { extraction, model } = await extractInvoiceData(pdf.base64, pdf.name)
  console.log(`Model: ${model}`)
  console.log(`Vendor: ${extraction.vendorName}`)
  console.log(`Invoice #: ${extraction.invoiceNumber}`)
  console.log(`Date: ${extraction.invoiceDate}`)
  console.log(`Total: $${extraction.totalAmount}\n`)
  console.log("Line items:")
  for (const li of extraction.lineItems) {
    const pack = li.packSize ?? "-"
    const size = li.unitSize ?? "-"
    const uom = li.unitSizeUom ?? "-"
    console.log(
      `  L${String(li.lineNumber).padStart(2)}  sku=${(li.sku ?? "-").padEnd(10)}  qty=${String(li.quantity).padStart(4)} ${(li.unit ?? "-").padEnd(4)}  pack=${pack} × size=${size} ${uom.padEnd(6)}  $${li.unitPrice}/u  ext=$${li.extendedPrice}  ${li.productName}`
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
