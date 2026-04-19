import { GoogleGenAI } from "@google/genai"
import OpenAI from "openai"
import type { InvoiceExtraction } from "@/types/invoice"

export const PRIMARY_MODEL = "gpt-4.1-mini"
export const FALLBACK_MODEL = "gemini-2.5-flash"

export interface InvoiceExtractionResult {
  extraction: InvoiceExtraction
  /** ID of the model that actually produced the extraction (primary or fallback). */
  model: string
}

function buildExtractionPrompt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `You are an invoice data extraction specialist for restaurant food & beverage suppliers.
Extract ALL data from this supplier invoice PDF. Common vendors include Sysco, US Foods,
Performance Food Group, Restaurant Depot, Ben E. Keith, Individual FoodService, Premier Meats,
and similar distributors.

TODAY'S DATE IS APPROXIMATELY ${today}. Invoices are almost always dated within the last
few weeks. If you see a date that would be more than one year old (e.g. a 2-digit year,
a date printed in a template/header, a copyright year, or a reference invoice at the
bottom of a statement), it is probably NOT the invoice date — return null for that field
rather than guessing. NEVER invent a year. If only the month and day are clearly printed,
return null, not a guessed year.

IMPORTANT — For each line item you MUST extract the vendor item code / SKU number:
- Sysco: 7-digit item number (e.g. "1234567") — found in the "Item #" or "Item" column
- US Foods: 7-8 digit product code — found in the "Item#" or "Product #" column
- Individual FoodService (IFS): item code in the leftmost column
- Restaurant Depot: item number on each line
- Other vendors: look for any column labeled "Item", "Item #", "SKU", "Code", "Product #", or similar
If no item code is visible for a line item, set sku to null — but NEVER omit the sku field.

QUANTITY, PACK, and SIZE — these are FIVE separate fields on every case-goods line:
- quantity: number of cases/eaches shipped    (e.g. 10)
- unit: UoM for quantity                      ("CS" / "EA" / "LB" / "GAL")
- packSize: items per case                    (e.g. 6)
- unitSize: size of each packed item          (e.g. 64)
- unitSizeUom: UoM of unitSize                ("OZ" / "FL OZ" / "LB" / "GAL" / "CT")

CRITICAL — on Sysco, US Foods, and most distributor invoices the Pack and Size columns
print with narrow spacing and visually look FUSED (two cells "6" and "64 OZ" render as
"664 OZ"). You MUST split them using food-packaging plausibility. The pack takes the
LEADING 1–2 digits; the size is everything after, including decimals.

Worked examples — what appears on the PDF → correct split:
    "664 OZ"   → packSize=6,  unitSize=64,  unitSizeUom="OZ"    (a 64oz jug × 6 per case)
    "301 LB"   → packSize=30, unitSize=1,   unitSizeUom="LB"    (30 × 1-lb butter solids)
    "64.5 LB"  → packSize=6,  unitSize=4.5, unitSizeUom="LB"    (6 × 4.5-lb fry bags)
    "98 CT"    → packSize=9,  unitSize=8,   unitSizeUom="CT"    (9 × 8-count rolls)
    "135 LB"   → packSize=1,  unitSize=35,  unitSizeUom="LB"    (1 × 35-lb shortening tub)
    "6/64 OZ"  → packSize=6,  unitSize=64,  unitSizeUom="OZ"    (some vendors print slash)
    "4/1 GAL"  → packSize=4,  unitSize=1,   unitSizeUom="GAL"

Plausible size ranges to sanity-check the split (NOT hard limits — for guidance only):
    OZ: 4–256   FL OZ: 4–128   LB: 0.25–50   GAL: 0.25–10   CT: 4–500

Rules:
- If the product is meat sold by weight (Premier Meats, Ben E. Keith, similar deli meats)
  the invoice has NO pack — a single weighed item. Put the weight in quantity with
  unit="LB"; set packSize=null, unitSize=null, unitSizeUom=null.
- If only a count appears (produce: "1 CS 24 CT"), set packSize=24, unitSize=1,
  unitSizeUom="CT".
- If the split is truly ambiguous AND no plausible interpretation exists, return
  packSize=null and unitSize=null — do not guess.
- productName must NOT contain the pack, size, UoM, SKU, item number, pallet ID, brand
  code, or any internal tracking number. Only the human-readable product name belongs
  there. Strip trailing digits that look like catalog numbers.

For line items, classify each product into one of these categories:
Meat, Poultry, Seafood, Produce, Dairy, Bakery, Beverages, Dry Goods, Frozen,
Paper/Supplies, Cleaning, Equipment, Other

DELIVERY ADDRESS — extract the Ship-To / Deliver-To / Service Address street line,
city, state, and ZIP. Do NOT include the customer's business name, attention line, or
any label — only the address itself. Do NOT use the billing address, remit-to address,
or the vendor's own address. If the invoice shows only a billing address, return null.
Format: "<street>, <city>, <state> <zip>" on a single line — e.g.
"5539 W Sunset Blvd, Los Angeles, CA 90028". Common section labels to look for: "Ship To",
"Deliver To", "Delivery Address", "Service Address", "Location".

If a value cannot be determined, use null. Ensure extendedPrice = quantity * unitPrice
for each line item. Number the line items starting from 1.

If the PDF appears to contain MULTIPLE invoices (e.g. a consolidated statement or a
"CoPilot Invoices" summary), extract only the single invoice whose invoice number
matches the subject/filename most closely — pick the one with the clearest header,
and ignore the others. Do not merge totals across multiple invoices.

Return valid JSON matching this schema EXACTLY (every field must be present):
{
  "vendorName": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "deliveryAddress": "string or null",
  "lineItems": [{
    "lineNumber": number,
    "sku": "string or null — REQUIRED FIELD, the vendor item/product number",
    "productName": "string (clean item name only, no pack/size/SKU)",
    "description": "string or null",
    "category": "one of the categories above or null",
    "quantity": number,
    "unit": "string or null (CS, LB, EA, GAL, etc.)",
    "packSize": "integer or null — items per case, null for by-weight",
    "unitSize": "number or null — size of each packed unit, e.g. 64.0",
    "unitSizeUom": "string or null — OZ, FL OZ, LB, GAL, CT, etc.",
    "unitPrice": number,
    "extendedPrice": number
  }],
  "subtotal": number or null,
  "taxAmount": number or null,
  "totalAmount": number
}`
}

async function extractViaOpenAI(
  pdfBase64: string,
  fileName: string
): Promise<InvoiceExtraction> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required")
  const openai = new OpenAI({ apiKey, timeout: 60_000 })

  const response = await openai.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: fileName,
              file_data: `data:application/pdf;base64,${pdfBase64}`,
            },
          },
          { type: "text", text: buildExtractionPrompt() },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 16000,
  })

  const text = response.choices[0]?.message?.content
  if (!text) throw new Error("OpenAI returned empty response for invoice extraction")
  return JSON.parse(text) as InvoiceExtraction
}

async function extractViaGemini(pdfBase64: string): Promise<InvoiceExtraction> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("GEMINI_API_KEY env var is required")
  const ai = new GoogleGenAI({ apiKey })

  const response = await ai.models.generateContent({
    model: FALLBACK_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
          { text: buildExtractionPrompt() },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  })

  const text = response.text
  if (!text) throw new Error("Gemini returned empty response for invoice extraction")
  return JSON.parse(text) as InvoiceExtraction
}

/**
 * Returns true for errors that are worth retrying on the Gemini fallback:
 *   - 429 / rate limit / quota exceeded (primary provider throttled)
 *   - 5xx server errors
 *   - transient network failures
 * Auth or validation errors (4xx other than 429) propagate up unchanged — those
 * indicate a config bug that the fallback won't fix.
 */
function shouldFallBackToGemini(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit") || lower.includes("insufficient_quota")) {
    return true
  }
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
    return true
  }
  if (lower.includes("econnreset") || lower.includes("etimedout") || lower.includes("fetch failed") || lower.includes("timeout")) {
    return true
  }
  return false
}

export async function extractInvoiceData(
  pdfBase64: string,
  fileName: string
): Promise<InvoiceExtractionResult> {
  try {
    const extraction = await extractViaOpenAI(pdfBase64, fileName)
    return { extraction, model: PRIMARY_MODEL }
  } catch (err) {
    if (!shouldFallBackToGemini(err)) throw err
    console.warn(
      `OpenAI extraction failed (${err instanceof Error ? err.message.slice(0, 120) : err}), ` +
      `falling back to Gemini ${FALLBACK_MODEL}`
    )
    const extraction = await extractViaGemini(pdfBase64)
    return { extraction, model: FALLBACK_MODEL }
  }
}
