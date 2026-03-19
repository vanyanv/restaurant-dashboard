import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { fetchInvoiceEmails, getEmailAttachments } from "@/lib/microsoft-graph"
import { extractInvoiceData } from "@/lib/gemini-invoice"
import { matchInvoiceToStore } from "@/lib/address-matcher"
import type { InvoiceSyncProgressEvent } from "@/types/invoice"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

export const maxDuration = 120

// ─── Vendor name normalization ───
const VENDOR_ALIASES: Record<string, string> = {
  "sysco": "Sysco",
  "us foods": "US Foods",
  "individual foodservice": "Individual FoodService",
  "restaurant depot": "Restaurant Depot",
  "performance food group": "Performance Food Group",
  "ben e. keith": "Ben E. Keith",
}

function normalizeVendorName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  for (const [pattern, canonical] of Object.entries(VENDOR_ALIASES)) {
    if (lower.startsWith(pattern)) return canonical
  }
  return raw.trim()
}

type ProgressEmitter = (event: InvoiceSyncProgressEvent) => void

const PHASE_WEIGHTS = { emails: 0.1, extracting: 0.6, matching: 0.1, writing: 0.2 } as const

function computeProgress(emailPct: number, extractPct: number, matchPct: number, writePct: number): number {
  return Math.round(
    emailPct * PHASE_WEIGHTS.emails +
    extractPct * PHASE_WEIGHTS.extracting +
    matchPct * PHASE_WEIGHTS.matching +
    writePct * PHASE_WEIGHTS.writing
  )
}

/** Run async tasks with a concurrency limit. */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  taskTimeoutMs: number = 60_000,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++
      try {
        results[index] = await Promise.race([
          tasks[index](),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Task ${index} timed out after ${taskTimeoutMs}ms`)), taskTimeoutMs)
          ),
        ])
      } catch (err) {
        console.error(`Task ${index} failed:`, err)
        results[index] = null as T
      }
      completed++
      onProgress?.(completed, tasks.length)
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

interface SyncResult {
  message: string
  scanned: number
  created: number
  skipped: number
  errors: number
}

async function runSync(emit: ProgressEmitter, userId: string): Promise<SyncResult> {
  const counts = { scanned: 0, created: 0, skipped: 0, errors: 0 }

  // ─── Phase 1: Fetch emails ───
  emit({
    phase: "fetching-emails", status: "fetching", totalProgress: 0,
    detail: "Fetching emails with attachments...", counts,
  })

  // Look back 30 days for first sync, 7 days for subsequent
  const lastSync = await prisma.invoiceSyncLog.findFirst({
    orderBy: { startedAt: "desc" },
    where: { completedAt: { not: null } },
  })
  const lookbackDays = lastSync ? 7 : 30
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - lookbackDays)

  const allMessages = await fetchInvoiceEmails(sinceDate)

  // Filter out non-invoice emails (weekly statements, order confirmations, etc.)
  const SKIP_PATTERNS = [
    "weekly statement",
    "order confirmation",
    "tracking",
    "delivery notification",
  ]
  const messages = allMessages.filter((m) => {
    const subject = (m.subject ?? "").toLowerCase()
    return !SKIP_PATTERNS.some((pattern) => subject.includes(pattern))
  })

  counts.scanned = messages.length

  emit({
    phase: "fetching-emails", status: "done",
    totalProgress: computeProgress(100, 0, 0, 0),
    detail: `Found ${messages.length} invoice emails (${allMessages.length - messages.length} non-invoice skipped)`, counts,
  })

  if (messages.length === 0) {
    const syncLog = await prisma.invoiceSyncLog.create({
      data: { triggeredBy: userId, completedAt: new Date(), emailsScanned: 0 },
    })
    emit({
      phase: "complete", status: "done", totalProgress: 100,
      detail: "No emails with attachments found", counts,
    })
    return { message: `Sync complete (log: ${syncLog.id})`, ...counts }
  }

  // ─── Dedup: skip already-processed emails ───
  const messageIds = messages.map((m) => m.id)
  const existingInvoices = await prisma.invoice.findMany({
    where: { emailMessageId: { in: messageIds } },
    select: { emailMessageId: true },
  })
  const processedSet = new Set(existingInvoices.map((i) => i.emailMessageId))
  const newMessages = messages.filter((m) => !processedSet.has(m.id))
  counts.skipped = messages.length - newMessages.length

  emit({
    phase: "extracting", status: "processing",
    totalProgress: computeProgress(100, 0, 0, 0),
    detail: `${newMessages.length} new emails to process (${counts.skipped} already synced)`, counts,
  })

  if (newMessages.length === 0) {
    const syncLog = await prisma.invoiceSyncLog.create({
      data: {
        triggeredBy: userId, completedAt: new Date(),
        emailsScanned: counts.scanned, invoicesSkipped: counts.skipped,
      },
    })
    emit({
      phase: "complete", status: "done", totalProgress: 100,
      detail: `All ${counts.skipped} emails already synced`, counts,
    })
    return { message: `Sync complete (log: ${syncLog.id})`, ...counts }
  }

  // ─── Phase 2: Extract data from PDFs via OpenAI ───
  // Fetch stores for address matching
  const stores = await prisma.store.findMany({
    where: { ownerId: userId, isActive: true },
    select: { id: true, address: true },
  })

  interface ExtractedInvoice {
    messageId: string
    subject: string | null
    receivedAt: string
    attachmentName: string
    extraction: Awaited<ReturnType<typeof extractInvoiceData>>
    rawJson: string
  }

  const extractionTasks = newMessages.map((msg) => async () => {
    try {
      // Get PDF attachments
      const attachments = await getEmailAttachments(msg.id)
      if (attachments.length === 0) return null

      // Process the first PDF
      const pdf = attachments[0]
      const extraction = await extractInvoiceData(pdf.contentBytes, pdf.name)

      return {
        messageId: msg.id,
        subject: msg.subject,
        receivedAt: msg.receivedDateTime,
        attachmentName: pdf.name,
        extraction,
        rawJson: JSON.stringify(extraction),
      } satisfies ExtractedInvoice
    } catch (err) {
      console.error(`Failed to extract invoice from email "${msg.subject}":`, err)
      counts.errors++
      return null
    }
  })

  const extracted = await withConcurrency(extractionTasks, 3, 60_000, (completed, total) => {
    const pct = (completed / total) * 100
    emit({
      phase: "extracting", status: "processing",
      totalProgress: computeProgress(100, pct, 0, 0),
      detail: `Extracting invoices (${completed}/${total})...`, counts,
    })
  })

  const validExtractions = extracted.filter((e): e is ExtractedInvoice => e !== null)

  emit({
    phase: "matching", status: "processing",
    totalProgress: computeProgress(100, 100, 0, 0),
    detail: `Matching ${validExtractions.length} invoices to stores...`, counts,
  })

  // ─── Phase 3: Match addresses to stores ───
  const invoicesToCreate = validExtractions.map((inv) => {
    const match = inv.extraction.deliveryAddress
      ? matchInvoiceToStore(inv.extraction.deliveryAddress, stores)
      : null

    const status = match
      ? match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
      : "PENDING"

    return {
      ownerId: userId,
      storeId: match?.storeId ?? null,
      emailMessageId: inv.messageId,
      emailSubject: inv.subject,
      emailReceivedAt: inv.receivedAt ? new Date(inv.receivedAt) : null,
      attachmentName: inv.attachmentName,
      vendorName: normalizeVendorName(inv.extraction.vendorName),
      invoiceNumber: inv.extraction.invoiceNumber,
      invoiceDate: inv.extraction.invoiceDate ? new Date(inv.extraction.invoiceDate) : null,
      dueDate: inv.extraction.dueDate ? new Date(inv.extraction.dueDate) : null,
      deliveryAddress: inv.extraction.deliveryAddress,
      subtotal: inv.extraction.subtotal,
      taxAmount: inv.extraction.taxAmount,
      totalAmount: inv.extraction.totalAmount,
      status: status as "MATCHED" | "REVIEW" | "PENDING",
      matchConfidence: match?.confidence ?? null,
      matchedAt: match ? new Date() : null,
      rawExtractionJson: inv.rawJson,
      extractionModel: "gpt-4o",
      lineItems: inv.extraction.lineItems,
    }
  })

  emit({
    phase: "writing", status: "writing",
    totalProgress: computeProgress(100, 100, 100, 0),
    detail: `Saving ${invoicesToCreate.length} invoices...`, counts,
  })

  // ─── Phase 4: Write to database ───
  for (let i = 0; i < invoicesToCreate.length; i++) {
    const inv = invoicesToCreate[i]
    try {
      await prisma.invoice.create({
        data: {
          ownerId: inv.ownerId,
          storeId: inv.storeId,
          emailMessageId: inv.emailMessageId,
          emailSubject: inv.emailSubject,
          emailReceivedAt: inv.emailReceivedAt,
          attachmentName: inv.attachmentName,
          vendorName: inv.vendorName,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          deliveryAddress: inv.deliveryAddress,
          subtotal: inv.subtotal,
          taxAmount: inv.taxAmount,
          totalAmount: inv.totalAmount,
          status: inv.status,
          matchConfidence: inv.matchConfidence,
          matchedAt: inv.matchedAt,
          rawExtractionJson: inv.rawExtractionJson,
          extractionModel: inv.extractionModel,
          lineItems: {
            create: inv.lineItems.map((li) => ({
              lineNumber: li.lineNumber,
              sku: li.sku,
              productName: li.productName,
              description: li.description,
              category: li.category,
              quantity: li.quantity,
              unit: li.unit,
              unitPrice: li.unitPrice,
              extendedPrice: li.extendedPrice,
            })),
          },
        },
      })
      counts.created++
    } catch (err) {
      // Unique constraint violation = already processed (race condition safety)
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("Unique constraint")) {
        counts.skipped++
      } else {
        console.error(`Failed to save invoice ${inv.invoiceNumber}:`, err)
        counts.errors++
      }
    }

    const pct = ((i + 1) / invoicesToCreate.length) * 100
    emit({
      phase: "writing", status: "writing",
      totalProgress: computeProgress(100, 100, 100, pct),
      detail: `Saving invoices (${i + 1}/${invoicesToCreate.length})...`, counts,
    })
  }

  // Create sync log
  const syncLog = await prisma.invoiceSyncLog.create({
    data: {
      triggeredBy: userId,
      completedAt: new Date(),
      emailsScanned: counts.scanned,
      invoicesCreated: counts.created,
      invoicesSkipped: counts.skipped,
      errors: counts.errors,
    },
  })

  const message = `Invoice sync complete: ${counts.created} created, ${counts.skipped} skipped, ${counts.errors} errors`
  emit({
    phase: "complete", status: "done", totalProgress: 100,
    detail: message, counts,
  })

  return { message: `${message} (log: ${syncLog.id})`, ...counts }
}

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, RATE_LIMIT_TIERS.strict)
  if (limited) return limited

  const fromCron = isCronRequest(request)
  let userId: string

  if (fromCron) {
    // For cron, use the first OWNER user
    const owner = await prisma.user.findFirst({ where: { role: "OWNER" } })
    if (!owner) return NextResponse.json({ error: "No owner user found" }, { status: 500 })
    userId = owner.id
  } else {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "OWNER") {
      return NextResponse.json({ error: "Only owners can sync invoices" }, { status: 403 })
    }
    userId = session.user.id
  }

  const wantsSSE = request.headers.get("accept")?.includes("text/event-stream")

  if (wantsSSE) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emit: ProgressEmitter = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch { /* client disconnected */ }
        }
        try {
          await runSync(emit, userId)
        } catch (error) {
          console.error("Invoice sync error:", error)
          emit({
            phase: "error", status: "error", totalProgress: 0,
            detail: error instanceof Error ? error.message : "Internal server error",
            counts: { scanned: 0, created: 0, skipped: 0, errors: 0 },
            error: error instanceof Error ? error.message : "Internal server error",
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  }

  // JSON path (cron or non-SSE)
  try {
    const result = await runSync(() => {}, userId)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Invoice sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
