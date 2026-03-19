// scripts/test-openai-invoice.ts
// Run with: npx tsx scripts/test-openai-invoice.ts
// Tests OpenAI GPT-4o-mini extraction on the PDF saved by test-graph-email.ts

import fs from "fs"
import path from "path"
import OpenAI from "openai"

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

const env = loadEnvLocal()
const OPENAI_API_KEY = env["OPENAI_API_KEY"]

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env.local")
  process.exit(1)
}

// Find the test PDF
const testDir = path.resolve(process.cwd(), "scripts/test-output")
const pdfFiles = fs.existsSync(testDir)
  ? fs.readdirSync(testDir).filter((f) => f.endsWith(".pdf"))
  : []

if (pdfFiles.length === 0) {
  console.error("No PDF files found in scripts/test-output/")
  console.error("Run test-graph-email.ts first to download an invoice PDF.")
  process.exit(1)
}

const pdfPath = path.join(testDir, pdfFiles[0])
console.log(`╔══════════════════════════════════════════╗`)
console.log(`║  OpenAI Invoice Extraction Test          ║`)
console.log(`╚══════════════════════════════════════════╝\n`)
console.log(`PDF: ${pdfFiles[0]} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)}KB)\n`)

const EXTRACTION_PROMPT = `You are an invoice data extraction specialist for restaurant food & beverage suppliers.
Extract ALL data from this supplier invoice PDF. Common vendors include Sysco, US Foods,
Performance Food Group, Restaurant Depot, Ben E. Keith, and similar distributors.

For line items, classify each product into one of these categories:
Meat, Poultry, Seafood, Produce, Dairy, Bakery, Beverages, Dry Goods, Frozen,
Paper/Supplies, Cleaning, Equipment, Other

Extract the DELIVERY ADDRESS (not billing address) from the invoice. This is typically
labeled "Ship To" or "Deliver To".

If a value cannot be determined, use null. Ensure extendedPrice = quantity * unitPrice
for each line item. Number the line items starting from 1.

Return valid JSON matching this schema:
{
  "vendorName": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "deliveryAddress": "string or null",
  "lineItems": [{
    "lineNumber": number,
    "productName": "string",
    "description": "string or null",
    "category": "one of the categories above or null",
    "quantity": number,
    "unit": "string or null (CS, LB, EA, GAL, etc.)",
    "unitPrice": number,
    "extendedPrice": number
  }],
  "subtotal": number or null,
  "taxAmount": number or null,
  "totalAmount": number
}`

async function main() {
  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64")
  console.log(`Base64 size: ${(pdfBase64.length / 1024).toFixed(1)}KB`)
  console.log("Sending to OpenAI GPT-4o-mini...\n")

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

  const start = Date.now()
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: pdfFiles[0],
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 16000,
  })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  const text = response.choices[0]?.message?.content
  if (!text) {
    console.error("OpenAI returned empty response!")
    process.exit(1)
  }

  console.log(`✓ OpenAI responded in ${elapsed}s`)
  console.log(`  Tokens: ${response.usage?.prompt_tokens} input, ${response.usage?.completion_tokens} output`)
  console.log(`  Estimated cost: $${(
    ((response.usage?.prompt_tokens ?? 0) * 0.15 / 1_000_000) +
    ((response.usage?.completion_tokens ?? 0) * 0.6 / 1_000_000)
  ).toFixed(4)}\n`)

  const data = JSON.parse(text)

  // Save raw response
  const rawPath = path.join(testDir, "openai-response.json")
  fs.writeFileSync(rawPath, JSON.stringify(data, null, 2))
  console.log(`Raw response saved to: ${rawPath}\n`)

  // Display results
  console.log("=== EXTRACTED INVOICE DATA ===\n")
  console.log(`Vendor:           ${data.vendorName}`)
  console.log(`Invoice #:        ${data.invoiceNumber}`)
  console.log(`Invoice Date:     ${data.invoiceDate}`)
  console.log(`Due Date:         ${data.dueDate}`)
  console.log(`Delivery Address: ${data.deliveryAddress}`)
  console.log(`Subtotal:         $${data.subtotal?.toFixed(2) ?? "N/A"}`)
  console.log(`Tax:              $${data.taxAmount?.toFixed(2) ?? "N/A"}`)
  console.log(`Total:            $${data.totalAmount?.toFixed(2)}`)
  console.log(`\nLine Items (${data.lineItems?.length ?? 0}):`)
  console.log("─".repeat(100))
  console.log(
    "#".padEnd(4) +
    "Product".padEnd(35) +
    "Category".padEnd(16) +
    "Qty".padStart(8) +
    "Unit".padStart(6) +
    "Price".padStart(10) +
    "Total".padStart(12)
  )
  console.log("─".repeat(100))

  for (const item of data.lineItems ?? []) {
    console.log(
      String(item.lineNumber).padEnd(4) +
      (item.productName ?? "").slice(0, 33).padEnd(35) +
      (item.category ?? "?").padEnd(16) +
      String(item.quantity).padStart(8) +
      (item.unit ?? "").padStart(6) +
      `$${item.unitPrice?.toFixed(2)}`.padStart(10) +
      `$${item.extendedPrice?.toFixed(2)}`.padStart(12)
    )
  }
  console.log("─".repeat(100))

  // Summary by category
  const byCat: Record<string, number> = {}
  for (const item of data.lineItems ?? []) {
    const cat = item.category ?? "Other"
    byCat[cat] = (byCat[cat] ?? 0) + (item.extendedPrice ?? 0)
  }
  console.log("\n=== SPEND BY CATEGORY ===")
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1])
  for (const [cat, total] of sorted) {
    console.log(`  ${cat.padEnd(20)} $${total.toFixed(2)}`)
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
