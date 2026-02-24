import OpenAI from "openai"
import type { InvoiceExtraction } from "@/types/invoice"

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required")
  return new OpenAI({ apiKey, timeout: 45_000 })
}

const EXTRACTION_PROMPT = `You are an invoice data extraction specialist for restaurant food & beverage suppliers.
Extract ALL data from this supplier invoice PDF. Common vendors include Sysco, US Foods,
Performance Food Group, Restaurant Depot, Ben E. Keith, Individual FoodService, and similar distributors.

IMPORTANT — For each line item you MUST extract the vendor item code / SKU number:
- Sysco: 7-digit item number (e.g. "1234567") — found in the "Item #" or "Item" column
- US Foods: 7-8 digit product code — found in the "Item#" or "Product #" column
- Individual FoodService (IFS): item code in the leftmost column
- Restaurant Depot: item number on each line
- Other vendors: look for any column labeled "Item", "Item #", "SKU", "Code", "Product #", or similar
If no item code is visible for a line item, set sku to null — but NEVER omit the sku field.

For line items, classify each product into one of these categories:
Meat, Poultry, Seafood, Produce, Dairy, Bakery, Beverages, Dry Goods, Frozen,
Paper/Supplies, Cleaning, Equipment, Other

Extract the DELIVERY ADDRESS (not billing address) from the invoice. This is typically
labeled "Ship To" or "Deliver To".

If a value cannot be determined, use null. Ensure extendedPrice = quantity * unitPrice
for each line item. Number the line items starting from 1.

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

export async function extractInvoiceData(
  pdfBase64: string,
  fileName: string
): Promise<InvoiceExtraction> {
  const openai = getClient()

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
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

  const text = response.choices[0]?.message?.content
  if (!text) {
    throw new Error("OpenAI returned empty response for invoice extraction")
  }

  return JSON.parse(text) as InvoiceExtraction
}
