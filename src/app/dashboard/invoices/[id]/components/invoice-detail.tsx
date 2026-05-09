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

      <div className="flex-1 overflow-hidden flex flex-col p-2 sm:p-4 gap-3 sm:gap-4">
        {/* Split view: PDF | extracted data */}
        <div className="grid flex-1 min-h-0 gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
          {/* Left: original PDF */}
          <div className="min-h-[60vh] max-h-[75vh] lg:min-h-0 lg:max-h-none">
            <PdfViewer invoiceId={invoice.id} hasPdf={invoice.hasPdf} />
          </div>

          {/* Right: extracted fields + line items */}
          <div className="min-h-0 overflow-auto space-y-4 sm:space-y-6 pr-1">

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
            <div className="border border-(--hairline-bold) rounded-xs overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Pack</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lineItems.map((li) => (
                    <TableRow key={li.id}>
                      <TableCell className="text-(--ink-muted) tabular-nums">{li.lineNumber}</TableCell>
                      <TableCell className="font-medium max-w-[250px]">
                        <div className="truncate">{li.productName}</div>
                        {li.description && (
                          <div className="text-xs text-(--ink-muted) truncate">{li.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-(--ink-muted)">
                        {li.sku ?? "—"}
                      </TableCell>
                      <TableCell>
                        {li.category && (
                          <Badge variant="outline" className="text-xs">
                            {li.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{li.quantity}</TableCell>
                      <TableCell className="text-(--ink-muted)">{li.unit ?? "—"}</TableCell>
                      <TableCell className="text-right text-(--ink-muted) tabular-nums text-xs">
                        {li.packSize ?? "—"}
                      </TableCell>
                      <TableCell className="text-(--ink-muted) tabular-nums text-xs">
                        {li.unitSize != null
                          ? `${li.unitSize} ${li.unitSizeUom ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(li.unitPrice)}
                      </TableCell>
                      <TableCell
                        className="text-right font-medium tabular-nums"
                        style={li.extendedPrice < 0 ? { color: "var(--accent)" } : undefined}
                      >
                        {formatCurrency(li.extendedPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
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
