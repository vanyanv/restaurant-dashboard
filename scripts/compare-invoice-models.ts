// scripts/compare-invoice-models.ts
// Run the same Premier Meats invoice PDF through several models and see which
// gives the most consistent + correct extraction.
//
// Run with: npx tsx scripts/compare-invoice-models.ts

import fs from "fs"
import path from "path"
import OpenAI from "openai"
import { GoogleGenAI } from "@google/genai"

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

const PDF_PATH = path.resolve(process.cwd(), "scripts/test-output/premier-2232461.pdf")
if (!fs.existsSync(PDF_PATH)) {
  console.error(`PDF not found: ${PDF_PATH}. Run scripts/inspect-bad-invoice.ts first.`)
  process.exit(1)
}
const pdfBase64 = fs.readFileSync(PDF_PATH).toString("base64")

const today = new Date().toISOString().slice(0, 10)
const PROMPT = `Extract the following fields from this supplier invoice PDF. Today's date is approximately ${today}.
Return ONLY a JSON object, no surrounding text:
{
  "vendorName": string,
  "invoiceNumber": string,
  "invoiceDate": "YYYY-MM-DD" or null,
  "customerName": string (the bill-to / ship-to customer, not the vendor),
  "deliveryAddress": string (Ship-To or Deliver-To, full street + city + state + ZIP),
  "totalAmount": number
}
If a 2-digit year is printed, assume it is in the current century and close to today's date.
If you can't clearly read a field, return null — do NOT guess.`

interface Result {
  model: string
  attempt: number
  elapsed: number
  json?: Record<string, unknown>
  error?: string
  rawText?: string
}

async function callOpenAI(model: string): Promise<Result["json"] | { error: string; rawText?: string }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  // gpt-5* models require max_completion_tokens; older models still use max_tokens.
  const isGpt5 = model.startsWith("gpt-5") || model.startsWith("o3") || model.startsWith("o4")
  const res = await openai.chat.completions.create({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "file", file: { filename: "premier.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` } },
        { type: "text", text: PROMPT },
      ],
    }],
    response_format: { type: "json_object" },
    ...(isGpt5 ? { max_completion_tokens: 2000 } : { max_tokens: 800 }),
  })
  const txt = res.choices[0]?.message?.content ?? ""
  try { return JSON.parse(txt) } catch { return { error: "non-JSON response", rawText: txt.slice(0, 300) } }
}

async function callGemini(model: string): Promise<Result["json"] | { error: string; rawText?: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const res = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
        { text: PROMPT },
      ],
    }],
    config: { responseMimeType: "application/json" },
  })
  const txt = res.text ?? ""
  try { return JSON.parse(txt) } catch { return { error: "non-JSON response", rawText: txt.slice(0, 300) } }
}

async function run(label: string, fn: () => Promise<Result["json"] | { error: string; rawText?: string }>): Promise<Result> {
  const start = Date.now()
  try {
    const json = await fn()
    const elapsed = (Date.now() - start) / 1000
    if (json && typeof json === "object" && "error" in json) {
      return { model: label, attempt: 0, elapsed, error: json.error as string, rawText: (json as { rawText?: string }).rawText }
    }
    return { model: label, attempt: 0, elapsed, json: json as Record<string, unknown> }
  } catch (e) {
    return { model: label, attempt: 0, elapsed: (Date.now() - start) / 1000, error: e instanceof Error ? e.message : String(e) }
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "null"
  return String(v)
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║  MODEL COMPARISON — Premier Meats invoice 2232461                     ║")
  console.log(`║  PDF: ${(pdfBase64.length / 1024).toFixed(0)}KB base64`.padEnd(71) + "║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n")

  // Include only models we want to compare. Currently benchmarking OpenAI fallback candidates.
  const tasks: Array<{ label: string; fn: () => Promise<Result["json"] | { error: string; rawText?: string }> }> = [
    { label: "openai:gpt-4.1",           fn: () => callOpenAI("gpt-4.1") },
    { label: "openai:gpt-4.1-mini",      fn: () => callOpenAI("gpt-4.1-mini") },
    { label: "openai:gpt-5",             fn: () => callOpenAI("gpt-5") },
    { label: "openai:gpt-5-mini",        fn: () => callOpenAI("gpt-5-mini") },
    { label: "gemini:gemini-2.5-flash",  fn: () => callGemini("gemini-2.5-flash") },
  ]

  // Run each model 2x sequentially to check consistency
  const results: Result[] = []
  for (const t of tasks) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      process.stdout.write(`  ${t.label.padEnd(30)} attempt ${attempt}... `)
      const r = await run(t.label, t.fn)
      r.attempt = attempt
      results.push(r)
      if (r.error) console.log(`✗ ${r.error.slice(0, 80)}`)
      else console.log(`✓ ${r.elapsed.toFixed(1)}s`)
    }
  }

  console.log("\n━━━ RESULTS ━━━\n")
  console.log(
    "model".padEnd(30) +
    "attempt".padEnd(10) +
    "date".padEnd(14) +
    "customer".padEnd(22) +
    "address".padEnd(38) +
    "total".padStart(10)
  )
  console.log("─".repeat(124))
  for (const r of results) {
    const j = r.json ?? {}
    if (r.error) {
      console.log(`${r.model.padEnd(30)}${String(r.attempt).padEnd(10)}ERROR: ${r.error.slice(0, 70)}`)
      continue
    }
    console.log(
      r.model.padEnd(30) +
      String(r.attempt).padEnd(10) +
      fmt(j.invoiceDate).padEnd(14) +
      fmt(j.customerName).slice(0, 20).padEnd(22) +
      fmt(j.deliveryAddress).slice(0, 36).padEnd(38) +
      fmt(j.totalAmount).padStart(10)
    )
  }

  console.log("\n━━━ CONSISTENCY (attempt 1 vs 2) ━━━\n")
  const byModel = new Map<string, Result[]>()
  for (const r of results) {
    const arr = byModel.get(r.model) ?? []
    arr.push(r)
    byModel.set(r.model, arr)
  }
  for (const [model, rs] of byModel) {
    if (rs.length < 2 || rs.some((x) => x.error)) {
      console.log(`  ${model.padEnd(30)} — skipped (error or missing attempt)`)
      continue
    }
    const [a, b] = rs
    const fields = ["invoiceDate", "customerName", "deliveryAddress", "totalAmount"] as const
    const agree = fields.filter((f) => String(a.json?.[f] ?? "") === String(b.json?.[f] ?? ""))
    console.log(`  ${model.padEnd(30)} ${agree.length}/${fields.length} fields matched across both runs` +
      (agree.length < fields.length ? `  (differ: ${fields.filter(f => !agree.includes(f)).join(", ")})` : ""))
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1) })
