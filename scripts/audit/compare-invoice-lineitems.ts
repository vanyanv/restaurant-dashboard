// scripts/audit/compare-invoice-lineitems.ts
//
// Run a set of known-problem invoices through several OpenAI models using the
// EXACT production extraction prompt, and print a per-line diff + reconciliation
// summary so we can pick the best model for line-item accuracy.
//
// Default target: the 3 "stubborn" invoices from mark-review.ts (including Sysco
// 945831303 whose tomato QTY is currently blank).
//
// Usage:
//   npx tsx scripts/audit/compare-invoice-lineitems.ts
//   npx tsx scripts/audit/compare-invoice-lineitems.ts --ids=cmoa1wl6t000004l29buyl779
//   npx tsx scripts/audit/compare-invoice-lineitems.ts --models=gpt-5-mini,gpt-5
//   npx tsx scripts/audit/compare-invoice-lineitems.ts --runs=2
//
// No DB writes. No production code paths touched.

import fs from "fs"
import path from "path"
import OpenAI from "openai"
import { loadEnvLocal, classifyDollarDelta, money } from "./lib"
import { buildExtractionPrompt } from "../../src/lib/gemini-invoice"
import type { InvoiceExtraction, InvoiceExtractionLineItem } from "../../src/types/invoice"

loadEnvLocal()

// ── CLI ──

const DEFAULT_IDS = [
  "cmoa1wl6t000004l29buyl779", // Sysco 945831303 — tomato QTY missing
  "cmn80us56002404jxhelpbyg0", // Premier Meats 2232461 — catch-weight
  "cmo5096qc001wlfu9t9r2us61", // IFS H04728-00 — zero-charge syrup
]
const DEFAULT_MODELS = ["gpt-4.1-mini", "gpt-5-nano", "gpt-5-mini", "gpt-5"]

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`))
  return hit ? hit.slice(flag.length + 1) : null
}

const TARGET_IDS = argValue("--ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_IDS
const MODELS = argValue("--models")?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS
const RUNS = Math.max(1, parseInt(argValue("--runs") ?? "1", 10))

const OUTPUT_DIR = path.resolve(process.cwd(), "scripts/test-output")
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ── Types ──

interface ExtractRun {
  model: string
  attempt: number
  elapsedMs: number
  json: InvoiceExtraction | null
  error: string | null
}

interface InvoiceRecord {
  id: string
  vendorName: string
  invoiceNumber: string
  totalAmount: number
  pdfBlobUrl: string | null
  pdfBlobPathname: string | null
  attachmentName: string | null
}

// ── PDF fetch ──
// Invoice PDFs are stored in Vercel Blob with access:"private". The stored
// pdfBlobUrl is NOT publicly fetchable — we must go through the Blob SDK,
// which authenticates via BLOB_READ_WRITE_TOKEN (or the default for the
// project). Uses the same helper the /api/invoices/[id]/pdf route uses.

async function fetchPdfBase64(inv: InvoiceRecord): Promise<{ base64: string; fileName: string }> {
  if (!inv.pdfBlobPathname) {
    throw new Error(
      `Invoice ${inv.invoiceNumber} has no pdfBlobPathname — PDF not uploaded to Blob. Re-sync this invoice first.`
    )
  }
  const { getInvoicePdfStream } = await import("../../src/lib/blob")
  const result = await getInvoicePdfStream(inv.pdfBlobPathname)
  if (!result || result.statusCode !== 200) {
    throw new Error(
      `Blob SDK returned status ${result?.statusCode ?? "null"} for ${inv.pdfBlobPathname}`
    )
  }
  // Convert Web ReadableStream → Buffer.
  const chunks: Uint8Array[] = []
  // @ts-expect-error — Node's Readable.from works on async-iterable streams; the SDK returns a Web stream
  for await (const chunk of result.stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
  }
  const buf = Buffer.concat(chunks)
  const fileName = inv.attachmentName ?? `${inv.vendorName}-${inv.invoiceNumber}.pdf`
  return { base64: buf.toString("base64"), fileName }
}

// ── Extraction ──

async function extract(
  openai: OpenAI,
  model: string,
  pdfBase64: string,
  fileName: string,
  attempt: number
): Promise<ExtractRun> {
  const start = Date.now()
  // gpt-5 family (and o-series reasoning models) use max_completion_tokens.
  // These models also spend tokens on hidden reasoning before responding, so
  // they need a larger budget AND low reasoning effort for straight-extraction
  // tasks — otherwise the budget is exhausted by reasoning and content is empty.
  const isReasoningFamily = model.startsWith("gpt-5") || model.startsWith("o")
  const body: Record<string, unknown> = {
    model,
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
  }
  if (isReasoningFamily) {
    body.max_completion_tokens = 32000
    body.reasoning_effort = "minimal"
  } else {
    body.max_tokens = 16000
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await openai.chat.completions.create(body as any)
    const elapsedMs = Date.now() - start
    const choice = response.choices[0]
    const txt = choice?.message?.content
    if (!txt) {
      const finish = choice?.finish_reason ?? "unknown"
      const usage = response.usage
      const usageStr = usage
        ? ` prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` +
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (((usage as any).completion_tokens_details?.reasoning_tokens)
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ` reasoning=${(usage as any).completion_tokens_details.reasoning_tokens}`
            : "")
        : ""
      return {
        model,
        attempt,
        elapsedMs,
        json: null,
        error: `empty response (finish=${finish}${usageStr})`,
      }
    }
    try {
      return { model, attempt, elapsedMs, json: JSON.parse(txt) as InvoiceExtraction, error: null }
    } catch {
      return {
        model,
        attempt,
        elapsedMs,
        json: null,
        error: `non-JSON: ${txt.slice(0, 120)}`,
      }
    }
  } catch (err) {
    return {
      model,
      attempt,
      elapsedMs: Date.now() - start,
      json: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Scoring ──

interface RunScore {
  lineCount: number
  nullQtyCount: number
  sumExtended: number
  subtotal: number | null
  reconcileDeltaVsSubtotal: number | null
  reconcileDeltaVsStoredTotal: number
}

function scoreRun(run: ExtractRun, storedTotal: number): RunScore | null {
  if (!run.json) return null
  const lines = run.json.lineItems ?? []
  const sumExtended = lines.reduce((acc, l) => acc + (Number(l.extendedPrice) || 0), 0)
  const nullQtyCount = lines.filter((l) => l.quantity == null || Number(l.quantity) === 0).length
  const subtotal = run.json.subtotal ?? null
  return {
    lineCount: lines.length,
    nullQtyCount,
    sumExtended,
    subtotal,
    reconcileDeltaVsSubtotal: subtotal != null ? +(sumExtended - subtotal).toFixed(2) : null,
    reconcileDeltaVsStoredTotal: +(run.json.totalAmount - storedTotal).toFixed(2),
  }
}

// ── Diff table rendering ──

const FIELDS: Array<keyof InvoiceExtractionLineItem> = [
  "productName",
  "sku",
  "quantity",
  "unit",
  "packSize",
  "unitSize",
  "unitSizeUom",
  "unitPrice",
  "extendedPrice",
]

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2)
  const s = String(v)
  return s.length > 22 ? s.slice(0, 21) + "…" : s
}

function padCell(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w - 1) + "…"
  return s + " ".repeat(w - s.length)
}

function renderLineItemDiff(
  runs: ExtractRun[],
  storedInvNum: string
): string {
  const successRuns = runs.filter((r) => r.json)
  if (successRuns.length === 0) return "  (no successful runs — nothing to diff)"

  // Pick the first attempt of each model for the diff (subsequent attempts
  // still show up in the consistency rollup).
  const firstByModel = new Map<string, ExtractRun>()
  for (const r of successRuns) {
    if (!firstByModel.has(r.model)) firstByModel.set(r.model, r)
  }
  const modelRuns = Array.from(firstByModel.values())

  const maxLine = Math.max(
    ...modelRuns.map((r) => (r.json?.lineItems ?? []).reduce((m, l) => Math.max(m, l.lineNumber), 0))
  )

  const COL_W = 22
  const header =
    padCell("line", 5) +
    padCell("field", 14) +
    modelRuns.map((r) => padCell(r.model, COL_W)).join("")
  const sep = "─".repeat(header.length)

  const lines: string[] = []
  lines.push(`  Line-item diff — invoice ${storedInvNum}`)
  lines.push("  " + header)
  lines.push("  " + sep)

  for (let ln = 1; ln <= maxLine; ln++) {
    const perModel = modelRuns.map((r) =>
      (r.json?.lineItems ?? []).find((l) => l.lineNumber === ln) ?? null
    )

    // Skip if no model has this line
    if (perModel.every((l) => l == null)) continue

    for (const field of FIELDS) {
      const cells = perModel.map((li) => (li == null ? "—" : fmtVal(li[field])))
      // Flag if values differ across models
      const uniq = new Set(cells.filter((c) => c !== "—"))
      const flag = uniq.size > 1 ? " ⚠" : ""
      lines.push(
        "  " +
          padCell(String(ln), 5) +
          padCell(String(field) + flag, 14) +
          cells.map((c) => padCell(c, COL_W)).join("")
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ── Main ──

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║  INVOICE LINE-ITEM MODEL BAKEOFF                                     ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log(`  models: ${MODELS.join(", ")}`)
  console.log(`  runs/model: ${RUNS}`)
  console.log(`  invoice ids: ${TARGET_IDS.length}`)
  console.log("")

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set in .env.local")
    process.exit(2)
  }

  const { prisma } = await import("../../src/lib/prisma")

  const invoices = (await prisma.invoice.findMany({
    where: { id: { in: TARGET_IDS } },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      totalAmount: true,
      pdfBlobUrl: true,
      pdfBlobPathname: true,
      attachmentName: true,
    },
  })) as InvoiceRecord[]

  const foundIds = new Set(invoices.map((i) => i.id))
  const missing = TARGET_IDS.filter((id) => !foundIds.has(id))
  if (missing.length > 0) {
    console.warn(`⚠  ${missing.length} invoice id(s) not found in DB: ${missing.join(", ")}`)
  }
  if (invoices.length === 0) {
    console.error("No invoices to run. Exiting.")
    await prisma.$disconnect()
    process.exit(1)
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120_000 })

  interface SummaryRow {
    invoiceNumber: string
    model: string
    attempt: number
    lines: number
    nullQty: number
    reconcileVsSubtotal: number | null
    reconcileVsTotal: number
    elapsedMs: number
    error: string | null
  }
  const summary: SummaryRow[] = []

  for (const inv of invoices) {
    console.log(`━━━ ${inv.vendorName} #${inv.invoiceNumber}  [${inv.id}] ━━━`)
    console.log(`  stored totalAmount: ${money(inv.totalAmount)}`)

    let pdf: { base64: string; fileName: string }
    try {
      pdf = await fetchPdfBase64(inv)
      console.log(`  ✓ PDF fetched (${(pdf.base64.length / 1024).toFixed(0)} KB base64)`)
    } catch (err) {
      console.log(`  ✗ PDF fetch failed: ${err instanceof Error ? err.message : err}`)
      continue
    }

    const runs: ExtractRun[] = []
    for (const model of MODELS) {
      for (let attempt = 1; attempt <= RUNS; attempt++) {
        process.stdout.write(`  ${model.padEnd(16)} attempt ${attempt}... `)
        const run = await extract(openai, model, pdf.base64, pdf.fileName, attempt)
        runs.push(run)
        if (run.error) {
          console.log(`✗ ${run.error.slice(0, 90)}`)
        } else {
          console.log(`✓ ${(run.elapsedMs / 1000).toFixed(1)}s (${run.json?.lineItems?.length ?? 0} lines)`)
        }

        // Save per-run JSON for later diffing.
        const suffix = RUNS > 1 ? `-run${attempt}` : ""
        const outPath = path.join(
          OUTPUT_DIR,
          `compare-lineitems-${inv.invoiceNumber}-${model}${suffix}.json`
        )
        fs.writeFileSync(
          outPath,
          JSON.stringify({ model, attempt, elapsedMs: run.elapsedMs, error: run.error, json: run.json }, null, 2)
        )

        // Build summary row.
        const score = scoreRun(run, inv.totalAmount)
        summary.push({
          invoiceNumber: inv.invoiceNumber,
          model,
          attempt,
          lines: score?.lineCount ?? 0,
          nullQty: score?.nullQtyCount ?? 0,
          reconcileVsSubtotal: score?.reconcileDeltaVsSubtotal ?? null,
          reconcileVsTotal: score?.reconcileDeltaVsStoredTotal ?? 0,
          elapsedMs: run.elapsedMs,
          error: run.error,
        })
      }
    }

    console.log("")
    console.log(renderLineItemDiff(runs, inv.invoiceNumber))
    console.log("")
  }

  // ── Summary ──
  console.log("━━━ SUMMARY ━━━")
  console.log(
    padCell("invoice", 12) +
      padCell("model", 18) +
      padCell("att", 5) +
      padCell("lines", 7) +
      padCell("null-qty", 10) +
      padCell("Δ sub", 12) +
      padCell("Δ stored", 12) +
      padCell("latency", 10) +
      "status"
  )
  console.log("─".repeat(96))
  for (const r of summary) {
    const subStr = r.reconcileVsSubtotal == null ? "—" : money(r.reconcileVsSubtotal)
    const totStr = money(r.reconcileVsTotal)
    // Severity flag for reconciliation deltas, using shared classifier.
    const subSev = r.reconcileVsSubtotal == null
      ? ""
      : classifyDollarDelta(Math.abs(r.reconcileVsSubtotal), Math.max(1, Math.abs(r.reconcileVsSubtotal)) ) === "CRITICAL"
      ? "!"
      : ""
    console.log(
      padCell(r.invoiceNumber, 12) +
        padCell(r.model, 18) +
        padCell(String(r.attempt), 5) +
        padCell(String(r.lines), 7) +
        padCell(String(r.nullQty), 10) +
        padCell(subStr + subSev, 12) +
        padCell(totStr, 12) +
        padCell(`${(r.elapsedMs / 1000).toFixed(1)}s`, 10) +
        (r.error ? `✗ ${r.error.slice(0, 40)}` : "ok")
    )
  }

  // ── Per-model rollup ──
  console.log("\n━━━ PER-MODEL ROLLUP ━━━")
  const byModel = new Map<string, SummaryRow[]>()
  for (const r of summary) {
    const arr = byModel.get(r.model) ?? []
    arr.push(r)
    byModel.set(r.model, arr)
  }
  for (const [model, rows] of byModel) {
    const ok = rows.filter((r) => !r.error)
    const totalNullQty = ok.reduce((s, r) => s + r.nullQty, 0)
    const worstRecon = ok.reduce(
      (m, r) => Math.max(m, Math.abs(r.reconcileVsTotal)),
      0
    )
    const avgLatency = ok.length === 0 ? 0 : ok.reduce((s, r) => s + r.elapsedMs, 0) / ok.length / 1000
    console.log(
      `  ${padCell(model, 18)} runs=${rows.length}  ok=${ok.length}  ` +
        `null-qty=${totalNullQty}  worst-stored-Δ=${money(worstRecon)}  avg-latency=${avgLatency.toFixed(1)}s`
    )
  }

  console.log(`\nPer-model JSON saved to: ${OUTPUT_DIR}/compare-lineitems-<invoice>-<model>.json`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
