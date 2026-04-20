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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

        {/* Invoice Header */}
        <div className="grid gap-4 grid-cols-1">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-xl">{invoice.vendorName}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Invoice #{invoice.invoiceNumber}
                  </p>
                </div>
                <Badge variant={statusStyle.variant} className="text-sm">
                  {statusStyle.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 grid-cols-2 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {invoice.invoiceDate ? formatDateUS(invoice.invoiceDate) : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="font-medium">{invoice.dueDate ? formatDateUS(invoice.dueDate) : "N/A"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Subtotal</p>
                <p className="font-medium">{invoice.subtotal != null ? formatCurrency(invoice.subtotal) : "N/A"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tax</p>
                <p className="font-medium">{invoice.taxAmount != null ? formatCurrency(invoice.taxAmount) : "N/A"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Delivery Address</p>
                <p className="font-medium flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {invoice.deliveryAddress ?? "Not extracted"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{formatCurrency(invoice.totalAmount)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <p className="text-xs text-muted-foreground mt-1">
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

              {/* Email Info */}
              <div className="border-t pt-4 space-y-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {invoice.emailSubject ?? "No subject"}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {invoice.attachmentName ?? "Unknown file"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Line Items Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Line Items ({invoice.lineItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
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
                      <TableCell className="text-muted-foreground">{li.lineNumber}</TableCell>
                      <TableCell className="font-medium max-w-[250px]">
                        <div className="truncate">{li.productName}</div>
                        {li.description && (
                          <div className="text-xs text-muted-foreground truncate">{li.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
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
                      <TableCell className="text-muted-foreground">{li.unit ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums text-xs">
                        {li.packSize ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums text-xs">
                        {li.unitSize != null
                          ? `${li.unitSize} ${li.unitSizeUom ?? ""}`.trim()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(li.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
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
                    <div key={cat} className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">{cat}</p>
                      <p className="font-medium">{formatCurrency(total)}</p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
          </div>
        </div>
      </div>
    </>
  )
}
