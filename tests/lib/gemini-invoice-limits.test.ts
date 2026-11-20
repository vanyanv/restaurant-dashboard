// Invoice extraction limits (2026-11-20 audit): the OpenAI client retried on
// its own inside a 60s timeout, so a slow read used the whole task and the
// Gemini fallback never ran; Gemini had no timeout at all; and the model's
// answer was cast straight to InvoiceExtraction, so a cut-off or misshapen
// answer was stored or crashed the sync.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const openaiCreate = vi.hoisted(() => vi.fn())
const openaiCtor = vi.hoisted(() => vi.fn())
const geminiGenerate = vi.hoisted(() => vi.fn())

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: openaiCreate } }
    constructor(opts: unknown) {
      openaiCtor(opts)
    }
  },
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiGenerate }
  },
}))
vi.mock("@/lib/monitoring/ai-usage", () => ({ recordAiUsage: vi.fn(async () => {}) }))

import {
  ExtractionOutputError,
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  extractInvoiceData,
  parseExtraction,
  shouldFallBackToGemini,
} from "@/lib/gemini-invoice"

const good = {
  vendorName: "Sysco",
  invoiceNumber: "123",
  invoiceDate: "2026-11-18",
  dueDate: null,
  deliveryAddress: null,
  lineItems: [
    {
      lineNumber: 1, sku: "1", productName: "Buns", description: null, category: "Bakery",
      quantity: 2, unit: "CS", packSize: 8, unitSize: 12, unitSizeUom: "CT", unitPrice: 10, extendedPrice: 20,
    },
  ],
  subtotal: 20,
  taxAmount: 0,
  totalAmount: 20,
  isReturn: false,
}

const openaiAnswer = (content: string, finish_reason = "stop") => ({
  choices: [{ finish_reason, message: { content } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
})

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "k")
  vi.stubEnv("GEMINI_API_KEY", "k")
  openaiCreate.mockReset()
  openaiCtor.mockReset()
  geminiGenerate.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe("parseExtraction", () => {
  it("accepts the expected shape", () => {
    const e = parseExtraction(JSON.stringify(good), "test")
    expect(e.lineItems).toHaveLength(1)
    expect(e.totalAmount).toBe(20)
  })

  it("refuses an answer with no lineItems array", () => {
    expect(() => parseExtraction(JSON.stringify({ ...good, lineItems: "none" }), "test")).toThrow(ExtractionOutputError)
    expect(() => parseExtraction("[]", "test")).toThrow(ExtractionOutputError)
    expect(() => parseExtraction("{not json", "test")).toThrow(ExtractionOutputError)
  })

  it("refuses a line that is not an object", () => {
    expect(() => parseExtraction(JSON.stringify({ ...good, lineItems: [null] }), "test")).toThrow(ExtractionOutputError)
  })

  it("coerces a number printed as text, and sets an unreadable one to null rather than inventing it", () => {
    const e = parseExtraction(
      JSON.stringify({
        ...good,
        totalAmount: "1,234.50",
        lineItems: [{ ...good.lineItems[0], quantity: "3", unitPrice: "n/a", productName: null }],
      }),
      "test"
    )
    expect(e.totalAmount).toBe(1234.5)
    expect(e.lineItems[0].quantity).toBe(3)
    expect(e.lineItems[0].unitPrice).toBeNull()
    expect(e.lineItems[0].productName).toBe("")
  })
})

describe("extractInvoiceData", () => {
  it("asks OpenAI with no SDK retries and a timeout inside the budget", async () => {
    openaiCreate.mockResolvedValue(openaiAnswer(JSON.stringify(good)))
    const res = await extractInvoiceData("pdf", "a.pdf")
    expect(res.model).toBe(PRIMARY_MODEL)
    expect(openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
    const opts = openaiCreate.mock.calls[0][1] as { maxRetries: number; timeout: number; signal: AbortSignal }
    expect(opts.maxRetries).toBe(0)
    expect(opts.timeout).toBeLessThanOrEqual(28_000)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it("falls back to Gemini when the OpenAI answer was cut off at the token limit", async () => {
    // Parses fine, but finish_reason says lines are missing.
    openaiCreate.mockResolvedValue(openaiAnswer(JSON.stringify(good), "length"))
    geminiGenerate.mockResolvedValue({ text: JSON.stringify(good), candidates: [{ finishReason: "STOP" }] })
    const res = await extractInvoiceData("pdf", "a.pdf")
    expect(res.model).toBe(FALLBACK_MODEL)
    // Gemini gets an abort signal too (it had no timeout before).
    const cfg = geminiGenerate.mock.calls[0][0].config as { abortSignal: AbortSignal }
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it("falls back to Gemini on a misshapen OpenAI answer", async () => {
    openaiCreate.mockResolvedValue(openaiAnswer(JSON.stringify({ vendorName: "x" })))
    geminiGenerate.mockResolvedValue({ text: JSON.stringify(good) })
    const res = await extractInvoiceData("pdf", "a.pdf")
    expect(res.model).toBe(FALLBACK_MODEL)
  })

  it("falls back to Gemini when OpenAI times out", async () => {
    const err = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" })
    openaiCreate.mockRejectedValue(err)
    geminiGenerate.mockResolvedValue({ text: JSON.stringify(good) })
    const res = await extractInvoiceData("pdf", "a.pdf")
    expect(res.model).toBe(FALLBACK_MODEL)
  })

  it("throws when Gemini's answer is also cut off, instead of storing a partial bill", async () => {
    openaiCreate.mockResolvedValue(openaiAnswer(JSON.stringify(good), "length"))
    geminiGenerate.mockResolvedValue({ text: JSON.stringify(good), candidates: [{ finishReason: "MAX_TOKENS" }] })
    await expect(extractInvoiceData("pdf", "a.pdf")).rejects.toThrow(ExtractionOutputError)
  })

  it("does not start a fallback once the caller has given up", async () => {
    const controller = new AbortController()
    openaiCreate.mockImplementation(async () => {
      controller.abort(new Error("task timed out"))
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })
    })
    await expect(extractInvoiceData("pdf", "a.pdf", { signal: controller.signal })).rejects.toThrow()
    expect(geminiGenerate).not.toHaveBeenCalled()
  })

  it("aborts a slow Gemini read at its budget", async () => {
    openaiCreate.mockRejectedValue(new Error("503 Service Unavailable"))
    geminiGenerate.mockImplementation(
      ({ config }: { config: { abortSignal: AbortSignal } }) =>
        new Promise((_, reject) => config.abortSignal.addEventListener("abort", () => reject(config.abortSignal.reason)))
    )
    const started = Date.now()
    await expect(extractInvoiceData("pdf", "a.pdf", { budgetMs: 5_100 })).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(6_000)
  }, 10_000)
})

describe("shouldFallBackToGemini", () => {
  it("treats the OpenAI SDK's timeout wording as a timeout", () => {
    expect(shouldFallBackToGemini(new Error("Request timed out."))).toBe(true)
  })
  it("does not fall back on an auth error", () => {
    expect(shouldFallBackToGemini(new Error("401 Incorrect API key"))).toBe(false)
  })
})
