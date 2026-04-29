import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { fetchInvoiceEmails, getEmailAttachments } from "@/lib/microsoft-graph"
import { extractInvoiceData } from "@/lib/gemini-invoice"
import { matchInvoiceToStore } from "@/lib/address-matcher"
import type { InvoiceSyncProgressEvent } from "@/types/invoice"
import { isCronRequest, rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"
import { sanitizeInvoiceDate, findLineMathMismatches } from "@/lib/invoice-sanity"
import { putInvoicePdf, type InvoicePdfUpload } from "@/lib/blob"
import { sendGraphMail } from "@/lib/graph-mail"
import { buildPriceAlertEmail, type PriceHike } from "@/lib/price-alert-email"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { matchNewLineItems } from "@/lib/ingredient-matching"
import { bustTags } from "@/lib/cache/cached"

const PRICE_ALERT_PCT_THRESHOLD = 5
const PRICE_ALERT_MIN_UNIT_PRICE = 0.5

export const maxDuration = 120

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

/**
 * After a sync run, compare each newly-created line item's unit price against the
 * most-recent prior order for the same (vendor, sku or productName). If any line
 * jumped ≥5% AND the latest unit price is ≥$0.50, log them and send a single
 * consolidated email to PRICE_ALERT_EMAIL (falling back to OTTER_EMAIL).
 *
 * Failures here are logged but never propagated — a flaky email path must not
 * break an otherwise-successful invoice sync.
 */
async function detectAndAlertPriceHikes(invoiceIds: string[], userId: string): Promise<void> {
  const recipient = process.env.PRICE_ALERT_EMAIL || process.env.OTTER_EMAIL
  if (!recipient) {
    console.warn("PRICE_ALERT_EMAIL / OTTER_EMAIL not set — skipping price-hike email")
  }

  const newLines = await prisma.invoiceLineItem.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: {
      sku: true,
      productName: true,
      category: true,
      unit: true,
      unitPrice: true,
      invoice: {
        select: {
          vendorName: true,
          invoiceDate: true,
          invoiceNumber: true,
        },
      },
    },
  })

  // Batch-fetch prior line items for every vendor touched in this sync — one query
  // replaces the old per-line findFirst (previously O(N) queries per sync).
  const vendorNames = Array.from(new Set(newLines.map((l) => l.invoice.vendorName)))
  const priorLines = vendorNames.length > 0
    ? await prisma.invoiceLineItem.findMany({
        where: {
          invoice: {
            ownerId: userId,
            vendorName: { in: vendorNames },
            invoiceDate: { not: null },
          },
        },
        select: {
          sku: true,
          productName: true,
          unitPrice: true,
          invoice: { select: { vendorName: true, invoiceDate: true } },
        },
      })
    : []

  type PriorCandidate = { unitPrice: number; date: Date }
  const priorsBySku = new Map<string, PriorCandidate[]>()
  const priorsByName = new Map<string, PriorCandidate[]>()
  for (const p of priorLines) {
    const date = p.invoice.invoiceDate
    if (!date) continue
    const candidate: PriorCandidate = { unitPrice: p.unitPrice, date }
    if (p.sku) {
      const key = `${p.invoice.vendorName}|${p.sku}`
      const arr = priorsBySku.get(key)
      if (arr) arr.push(candidate)
      else priorsBySku.set(key, [candidate])
    } else if (p.productName) {
      const key = `${p.invoice.vendorName}|${p.productName.toLowerCase()}`
      const arr = priorsByName.get(key)
      if (arr) arr.push(candidate)
      else priorsByName.set(key, [candidate])
    }
  }

  const hikes: PriceHike[] = []
  for (const li of newLines) {
    if (!li.invoice.invoiceDate) continue
    if (li.unitPrice < PRICE_ALERT_MIN_UNIT_PRICE) continue

    const currentDate = li.invoice.invoiceDate
    const candidates = li.sku
      ? priorsBySku.get(`${li.invoice.vendorName}|${li.sku}`) ?? []
      : li.productName
        ? priorsByName.get(`${li.invoice.vendorName}|${li.productName.toLowerCase()}`) ?? []
        : []

    let prior: PriorCandidate | null = null
    for (const c of candidates) {
      if (c.date >= currentDate) continue
      if (!prior || c.date > prior.date) prior = c
    }
    if (!prior || prior.unitPrice <= 0) continue

    const pctChange = ((li.unitPrice - prior.unitPrice) / prior.unitPrice) * 100
    if (pctChange < PRICE_ALERT_PCT_THRESHOLD) continue

    hikes.push({
      vendorName: li.invoice.vendorName,
      productName: li.productName,
      sku: li.sku,
      category: li.category,
      unit: li.unit,
      prevPrice: prior.unitPrice,
      prevDate: prior.date,
      latestPrice: li.unitPrice,
      latestDate: li.invoice.invoiceDate,
      pctChange,
      invoiceNumber: li.invoice.invoiceNumber,
    })
  }

  if (hikes.length === 0) {
    console.log(`Price-alert: no hikes ≥${PRICE_ALERT_PCT_THRESHOLD}% detected across ${newLines.length} new lines`)
    return
  }

  // Sort biggest jump first
  hikes.sort((a, b) => b.pctChange - a.pctChange)

  for (const h of hikes) {
    console.log(
      `Price hike: ${h.vendorName} ${h.productName} (sku ${h.sku ?? "—"}): ` +
      `$${h.prevPrice.toFixed(2)} → $${h.latestPrice.toFixed(2)} (+${h.pctChange.toFixed(1)}%)`
    )
  }

  if (!recipient) return
  const { subject, html } = buildPriceAlertEmail(hikes)
  const result = await sendGraphMail({ toEmail: recipient, subject, html })
  if (result.sent) {
    console.log(`Price-alert email sent to ${recipient}: ${hikes.length} hike(s)`)
  } else {
    console.error(`Price-alert email NOT sent: ${result.error}`)
  }
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

  type ExtractionPayload = Awaited<ReturnType<typeof extractInvoiceData>>["extraction"]
  interface ExtractedInvoice {
    messageId: string
    subject: string | null
    receivedAt: string
    attachmentName: string
    extraction: ExtractionPayload
    extractionModel: string
    rawJson: string
    pdfUpload: InvoicePdfUpload | null
  }

  const extractionTasks = newMessages.map((msg) => async () => {
    try {
      // Get PDF attachments
      const attachments = await getEmailAttachments(msg.id)
      if (attachments.length === 0) return null

      // Process the first PDF
      const pdf = attachments[0]
      const { extraction, model } = await extractInvoiceData(pdf.contentBytes, pdf.name)

      let pdfUpload: InvoicePdfUpload | null = null
      try {
        const buffer = Buffer.from(pdf.contentBytes, "base64")
        pdfUpload = await putInvoicePdf(msg.id, buffer)
      } catch (uploadErr) {
        console.error(`Failed to upload PDF to blob for "${msg.subject}":`, uploadErr)
        // Continue without PDF — backfill script can retry later.
      }

      return {
        messageId: msg.id,
        subject: msg.subject,
        receivedAt: msg.receivedDateTime,
        attachmentName: pdf.name,
        extraction,
        extractionModel: model,
        rawJson: JSON.stringify(extraction),
        pdfUpload,
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

    const emailReceivedAt = inv.receivedAt ? new Date(inv.receivedAt) : null
    const contextLabel = `${inv.extraction.vendorName} #${inv.extraction.invoiceNumber}`
    const invoiceDate = sanitizeInvoiceDate(
      inv.extraction.invoiceDate,
      emailReceivedAt,
      contextLabel
    )
    const dateSuspect =
      Boolean(inv.extraction.invoiceDate) && invoiceDate === null

    const mathMismatches = findLineMathMismatches(inv.extraction.lineItems)
    for (const m of mathMismatches) {
      console.warn(
        `[invoice-sync] math mismatch on ${contextLabel} line ${m.lineNumber} ` +
        `"${m.productName}": qty ${m.quantity} ${m.unit ?? ""} × $${m.unitPrice} = ` +
        `$${m.computed.toFixed(2)} but extendedPrice=$${m.extendedPrice.toFixed(2)} ` +
        `(implied qty ≈ ${m.impliedQuantity?.toFixed(2) ?? "n/a"})`
      )
    }

    let status: "MATCHED" | "REVIEW" | "PENDING"
    if (dateSuspect || mathMismatches.length > 0) {
      status = "REVIEW"
    } else if (match) {
      status = match.confidence >= 0.85 ? "MATCHED" : "REVIEW"
    } else {
      status = "PENDING"
    }

    return {
      ownerId: userId,
      storeId: match?.storeId ?? null,
      emailMessageId: inv.messageId,
      emailSubject: inv.subject,
      emailReceivedAt,
      attachmentName: inv.attachmentName,
      vendorName: normalizeVendorName(inv.extraction.vendorName),
      invoiceNumber: inv.extraction.invoiceNumber,
      invoiceDate,
      dueDate: inv.extraction.dueDate ? new Date(inv.extraction.dueDate) : null,
      deliveryAddress: inv.extraction.deliveryAddress,
      subtotal: inv.extraction.subtotal,
      taxAmount: inv.extraction.taxAmount,
      totalAmount: inv.extraction.totalAmount,
      status,
      matchConfidence: match?.confidence ?? null,
      matchedAt: match ? new Date() : null,
      rawExtractionJson: inv.rawJson,
      extractionModel: inv.extractionModel,
      pdfBlobPathname: inv.pdfUpload?.pathname ?? null,
      pdfBlobUrl: inv.pdfUpload?.url ?? null,
      pdfSize: inv.pdfUpload?.size ?? null,
      pdfUploadedAt: inv.pdfUpload?.uploadedAt ?? null,
      lineItems: inv.extraction.lineItems,
    }
  })

  emit({
    phase: "writing", status: "writing",
    totalProgress: computeProgress(100, 100, 100, 0),
    detail: `Saving ${invoicesToCreate.length} invoices...`, counts,
  })

  // ─── Phase 4: Write to database ───
  const createdInvoiceIds: string[] = []
  for (let i = 0; i < invoicesToCreate.length; i++) {
    const inv = invoicesToCreate[i]
    try {
      const created = await prisma.invoice.create({
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
          pdfBlobPathname: inv.pdfBlobPathname,
          pdfBlobUrl: inv.pdfBlobUrl,
          pdfSize: inv.pdfSize,
          pdfUploadedAt: inv.pdfUploadedAt,
          lineItems: {
            create: inv.lineItems.map((li) => {
              if (li.unit === "CS" && li.packSize == null) {
                console.warn(
                  `Line ${li.lineNumber} on ${inv.vendorName} #${inv.invoiceNumber} is unit=CS ` +
                  `but packSize is null — extraction may have missed the Pack column`
                )
              }
              return {
                lineNumber: li.lineNumber,
                sku: li.sku,
                productName: li.productName,
                description: li.description,
                category: li.category,
                quantity: li.quantity,
                unit: li.unit,
                packSize: li.packSize,
                unitSize: li.unitSize,
                unitSizeUom: li.unitSizeUom,
                unitPrice: li.unitPrice,
                extendedPrice: li.extendedPrice,
              }
            }),
          },
        },
      })
      createdInvoiceIds.push(created.id)
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

  // ─── Phase 5: auto-match line items to canonical ingredients ───
  if (createdInvoiceIds.length > 0) {
    try {
      const matchResult = await matchNewLineItems(userId, createdInvoiceIds)
      console.log(
        `[invoice-sync] matched ${matchResult.matchedBySku} by SKU, ` +
        `${matchResult.matchedByAlias} by alias, ${matchResult.unmatched} unmatched, ` +
        `${matchResult.costsUpdated} canonical costs refreshed`
      )
    } catch (err) {
      console.error("Ingredient matching failed:", err)
    }
  }

  // ─── Phase 6: detect price hikes vs prior orders and email the owner ───
  if (createdInvoiceIds.length > 0) {
    try {
      await detectAndAlertPriceHikes(createdInvoiceIds, userId)
    } catch (err) {
      console.error("Price-alert detection failed:", err)
    }
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

  // Bust the owner's invoice/dash/pnl caches if anything actually changed.
  // Skipping the call when `created === 0` keeps idle cron runs from
  // burning a Redis round-trip every minute.
  if (counts.created > 0) {
    await bustTags([`owner:${userId}`])
  }

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
