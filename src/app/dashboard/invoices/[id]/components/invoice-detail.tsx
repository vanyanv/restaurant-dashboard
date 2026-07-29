"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  FileText,
  MapPin,
  Mail,
  Calendar,
  CheckCircle2,
  XCircle,
  Undo2,
} from "lucide-react"
import { setInvoiceIsReturn } from "@/app/actions/invoice-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { toast } from "sonner"
import type { InvoiceDetail } from "@/types/invoice"
import { PdfViewer } from "./pdf-viewer"
import { formatDateUS } from "@/lib/format"

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount)
}

const STATUS_STYLES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  MATCHED: { label: "Matched", variant: "default" },
  APPROVED: { label: "Approved", variant: "default" },
  REVIEW: { label: "Review", variant: "secondary" },
  PENDING: { label: "Pending", variant: "outline" },
  REJECTED: { label: "Rejected", variant: "destructive" },
}

interface InvoiceDetailContentProps {
  invoice: InvoiceDetail
  stores: Array<{ id: string; name: string }>
}

export function InvoiceDetailContent({ invoice, stores }: InvoiceDetailContentProps) {
  const router = useRouter()
  const [status, setStatus] = useState(invoice.status)
  const [selectedStoreId, setSelectedStoreId] = useState(invoice.storeId ?? "unmatched")
  const [isPending, startTransition] = useTransition()
  const [isReturnPending, startReturnTransition] = useTransition()

  const handleToggleReturn = () => {
    const next = !invoice.isReturn
    startReturnTransition(async () => {
      const res = await setInvoiceIsReturn(invoice.id, next)
      if (res.ok) {
        toast.success(next ? "Marked as return / credit memo" : "Marked as regular invoice")
        router.refresh()
      } else {
        toast.error("Failed to update return flag")
      }
    })
  }

  const handleUpdateStatus = (newStatus: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setStatus(newStatus)
        toast.success(`Invoice ${newStatus.toLowerCase()}`)
        router.refresh()
      } else {
        toast.error("Failed to update status")
      }
    })
  }

  const handleAssignStore = (storeId: string) => {
    setSelectedStoreId(storeId)
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: storeId === "unmatched" ? null : storeId,
          status: storeId === "unmatched" ? "PENDING" : "MATCHED",
        }),
      })
      if (res.ok) {
        setStatus(storeId === "unmatched" ? "PENDING" : "MATCHED")
        toast.success("Store updated")
        router.refresh()
      } else {
        toast.error("Failed to update store")
      }
    })
  }

  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING

  // Group line items by category
  const categoryTotals: Record<string, number> = {}
  for (const li of invoice.lineItems) {
    const cat = li.category ?? "Other"
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + li.extendedPrice
  }

  // Line-level flags from the review reasons, so a bad line wears the red
  // itself instead of the whole invoice being vaguely suspect.
  const showReasons = status === "REVIEW" && invoice.reviewReasons.length > 0
  const flaggedLines = new Map<number, string[]>()
  if (showReasons) {
    for (const r of invoice.reviewReasons) {
      for (const n of r.lineNumbers ?? []) {
        flaggedLines.set(n, [...(flaggedLines.get(n) ?? []), r.message])
      }
    }
  }

  return (
    <>
      <EditorialTopbar
        section="§ 02"
        title={`Invoice · ${invoice.invoiceNumber}`}
        stamps={
          <span>
            {invoice.vendorName}
            {invoice.invoiceDate ? ` · ${formatDateUS(invoice.invoiceDate)}` : ""}
          </span>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/dashboard/invoices")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </EditorialTopbar>

      {/* No overflow-hidden anywhere on this chain — the window is the
          scroller, and an overflow-hidden ancestor silently disables the
          PDF pane's position:sticky. */}
      <div className="flex-1 flex flex-col p-2 sm:p-4 gap-3 sm:gap-4">
        {/* Split view: PDF | extracted data */}
        <div className="grid flex-1 gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2 lg:items-start">
          {/* Left: original PDF — sticky on desktop so it stays beside the
              line items while the page scrolls. Comparing line 9 against
              the document is the page's whole job. */}
          <div className="min-h-[60vh] max-h-[75vh] lg:sticky lg:top-16 lg:max-h-[calc(100vh-5.5rem)]">
            <PdfViewer invoiceId={invoice.id} hasPdf={invoice.hasPdf} />
          </div>

          {/* Right: extracted fields + line items */}
          <div className="space-y-4 sm:space-y-6 pr-1">

        {invoice.isReturn ? (
          <div
            role="status"
            aria-label="This document is a return or credit memo"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 14px",
              border: "1px solid var(--accent)",
              borderRadius: 2,
              background: "var(--accent-bg)",
              fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            <span>Return / Credit memo · subtracted from spend</span>
          </div>
        ) : null}

        {/* Why this invoice needs review — the sync's sanity findings,
            verbatim. Without this the REVIEW badge is a black box. */}
        {showReasons ? (
          <section className="rounded-xs border border-(--hairline-bold) bg-(--paper-warm) px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--accent-dark)">
              Flagged for review · {invoice.reviewReasons.length} finding
              {invoice.reviewReasons.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {invoice.reviewReasons.map((r, i) => (
                <li key={i} className="text-sm text-(--ink) leading-snug">
                  {r.message}
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-(--ink-faint)">
              Flagged lines are marked in the table below · verify against the PDF
            </p>
          </section>
        ) : null}

        {/* Invoice Header */}
        <div className="grid gap-4 grid-cols-1">
          <section className="inv-panel">
            <header className="inv-panel__head">
              <div className="flex flex-col gap-1">
                <span className="inv-panel__dept">{invoice.vendorName}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                  Invoice #{invoice.invoiceNumber}
                </span>
              </div>
              <Badge variant={statusStyle.variant} className="text-sm">
                {statusStyle.label}
              </Badge>
            </header>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Invoice Date</p>
                <p className="mt-1 font-medium tabular-nums flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-(--ink-muted)" />
                  {invoice.invoiceDate ? formatDateUS(invoice.invoiceDate) : "N/A"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Due Date</p>
                <p className="mt-1 font-medium tabular-nums">{invoice.dueDate ? formatDateUS(invoice.dueDate) : "N/A"}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Subtotal</p>
                <p className="mt-1 font-medium tabular-nums">{invoice.subtotal != null ? formatCurrency(invoice.subtotal) : "N/A"}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Tax</p>
                <p className="mt-1 font-medium tabular-nums">{invoice.taxAmount != null ? formatCurrency(invoice.taxAmount) : "N/A"}</p>
              </div>
              <div className="col-span-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Delivery Address</p>
                <p className="mt-1 font-medium flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-(--ink-muted)" />
                  {invoice.deliveryAddress ?? "Not extracted"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">Total Amount</p>
                <p
                  className="mt-1 text-2xl font-semibold tabular-nums"
                  style={invoice.totalAmount < 0 ? { color: "var(--accent)" } : undefined}
                >
                  {formatCurrency(invoice.totalAmount)}
                </p>
              </div>
            </div>
          </section>

          {/* Actions */}
          <section className="inv-panel">
            <header className="inv-panel__head">
              <span className="inv-panel__dept">Actions</span>
            </header>
            <div className="space-y-4">
              {/* Store Assignment */}
              <div>
                <p className="text-sm font-medium mb-2">Assign Store</p>
                <Select value={selectedStoreId} onValueChange={handleAssignStore} disabled={isPending}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unmatched">Unmatched</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {invoice.matchConfidence != null && (
                  <p className="text-xs text-(--ink-muted) mt-1 tabular-nums">
                    Auto-match confidence: {(invoice.matchConfidence * 100).toFixed(0)}%
                  </p>
                )}
              </div>

              {/* Status Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={status === "APPROVED" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => handleUpdateStatus("APPROVED")}
                  disabled={isPending || status === "APPROVED"}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant={status === "REJECTED" ? "destructive" : "outline"}
                  className="flex-1"
                  onClick={() => handleUpdateStatus("REJECTED")}
                  disabled={isPending || status === "REJECTED"}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
              </div>

              <p className="font-mono text-[10px] uppercase tracking-[0.12em] leading-relaxed text-(--ink-faint)">
                Approve records that the extracted numbers match the PDF ·
                Reject marks the extraction as wrong
              </p>

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handleToggleReturn}
                disabled={isReturnPending}
              >
                <Undo2 className="h-4 w-4 mr-1" />
                {invoice.isReturn ? "Mark as regular invoice" : "Mark as return / credit memo"}
              </Button>

              {/* Email Info */}
              <div className="border-t border-(--hairline) pt-4 space-y-2">
                <p className="text-xs text-(--ink-muted) flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {invoice.emailSubject ?? "No subject"}
                </p>
                <p className="text-xs text-(--ink-muted) flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {invoice.attachmentName ?? "Unknown file"}
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Line Items Table */}
        <section className="inv-panel">
          <header className="inv-panel__head">
            <span className="inv-panel__dept">
              Line Items · {invoice.lineItems.length}
            </span>
          </header>
          <div>
            {/* 7 columns, no horizontal scroll: SKU folds under the product
                name and Unit/Pack/Size merge — Unit Price and Total (the
                columns an owner actually checks) must never hide offscreen. */}
            <div className="border border-(--hairline-bold) rounded-xs overflow-x-auto">
              <Table className="table-fixed min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-[104px]">Category</TableHead>
                    <TableHead className="w-[64px] text-right">Qty</TableHead>
                    <TableHead className="w-[84px]">Pack</TableHead>
                    <TableHead className="w-[84px] text-right">Unit Price</TableHead>
                    <TableHead className="w-[92px] text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((li) => {
                    const flags = flaggedLines.get(li.lineNumber)
                    const packText = [
                      li.packSize != null ? String(li.packSize) : null,
                      li.unitSize != null
                        ? `${li.unitSize} ${li.unitSizeUom ?? ""}`.trim()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" × ")
                    return (
                      <TableRow
                        key={li.id}
                        className={flags ? "bg-(--accent)/5" : undefined}
                        title={flags?.join("\n")}
                      >
                        <TableCell
                          className={
                            flags
                              ? "font-medium tabular-nums text-(--accent-dark)"
                              : "text-(--ink-muted) tabular-nums"
                          }
                        >
                          {flags ? `⚑${li.lineNumber}` : li.lineNumber}
                        </TableCell>
                        <TableCell className="font-medium overflow-hidden">
                          <div className="truncate">{li.productName}</div>
                          <div className="text-xs text-(--ink-muted) truncate">
                            {[li.sku, li.description].filter(Boolean).join(" · ") || "—"}
                          </div>
                          {flags ? (
                            <div className="mt-0.5 font-mono text-[10px] leading-snug text-(--accent-dark) whitespace-normal">
                              {flags.join(" · ")}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="overflow-hidden">
                          {li.category && (
                            <Badge
                              variant="outline"
                              className="max-w-full truncate text-xs"
                              title={li.category}
                            >
                              {li.category}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {li.quantity}
                          {li.unit ? (
                            <span className="ml-1 text-xs text-(--ink-muted)">{li.unit}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-(--ink-muted) tabular-nums text-xs whitespace-nowrap">
                          {packText || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {formatCurrency(li.unitPrice)}
                        </TableCell>
                        <TableCell
                          className="text-right font-medium tabular-nums whitespace-nowrap"
                          style={
                            li.extendedPrice < 0 || flags
                              ? { color: "var(--accent-dark)" }
                              : undefined
                          }
                        >
                          {formatCurrency(li.extendedPrice)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Category Summary */}
            {Object.keys(categoryTotals).length > 0 && (
              <div className="mt-4 grid gap-2 grid-cols-2">
                {Object.entries(categoryTotals)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, total]) => (
                    <div
                      key={cat}
                      className="p-3 bg-(--paper-warm) border border-(--hairline) rounded-xs"
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">{cat}</p>
                      <p className="mt-1 font-medium tabular-nums">{formatCurrency(total)}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </section>
          </div>
        </div>
      </div>
    </>
  )
}
