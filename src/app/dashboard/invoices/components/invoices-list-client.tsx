"use client"

import { useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FileText } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import type { InvoiceListItem } from "@/types/invoice"
import { formatCurrency } from "@/lib/format"

const STATUS_STYLES: Record<
  string,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
  }
> = {
  MATCHED: { label: "Matched", variant: "default" },
  APPROVED: { label: "Approved", variant: "default" },
  REVIEW: { label: "Review", variant: "secondary" },
  PENDING: { label: "Pending", variant: "outline" },
  REJECTED: { label: "Rejected", variant: "destructive" },
}

interface InvoicesListClientProps {
  invoices: InvoiceListItem[]
  total: number
  page: number
  totalPages: number
  status: string
  storeId: string
}

function buildHref(params: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") q.set(k, v)
  }
  const qs = q.toString()
  return qs ? `/dashboard/invoices?${qs}` : "/dashboard/invoices"
}

export function InvoicesListClient({
  invoices,
  total,
  page,
  totalPages,
  status,
  storeId,
}: InvoicesListClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchInvoice = useCallback(
    (id: string) => {
      if (prefetchedRef.current.has(id)) return
      if (typeof navigator !== "undefined") {
        const conn = (navigator as Navigator & {
          connection?: { saveData?: boolean; effectiveType?: string }
        }).connection
        if (conn?.saveData) return
        if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g")
          return
      }
      prefetchedRef.current.add(id)
      router.prefetch(`/dashboard/invoices/${id}`)
      fetch(`/api/invoices/${id}/pdf`, { credentials: "same-origin" }).catch(
        () => {
          prefetchedRef.current.delete(id)
        }
      )
    },
    [router]
  )

  const handleStatus = (value: string) => {
    startTransition(() => {
      router.replace(
        buildHref({ storeId, status: value, page: undefined }),
        { scroll: false }
      )
    })
  }

  const handlePage = (nextPage: number) => {
    startTransition(() => {
      router.replace(
        buildHref({ storeId, status, page: String(nextPage) }),
        { scroll: false }
      )
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Invoices</CardTitle>
        <Select value={status} onValueChange={handleStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="MATCHED">Matched</SelectItem>
            <SelectItem value="REVIEW">Needs Review</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent
        className={isPending ? "opacity-60 pointer-events-none" : ""}
      >
        {invoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No invoices yet</p>
            <p className="text-sm mt-1">
              Click &quot;Sync Invoices&quot; to fetch from email
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const s = STATUS_STYLES[inv.status] ?? STATUS_STYLES.PENDING
                    return (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          router.push(`/dashboard/invoices/${inv.id}`)
                        }
                        onMouseEnter={() => prefetchInvoice(inv.id)}
                        onFocus={() => prefetchInvoice(inv.id)}
                        onTouchStart={() => prefetchInvoice(inv.id)}
                      >
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {inv.vendorName}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {inv.invoiceNumber}
                        </TableCell>
                        <TableCell>{inv.invoiceDate ?? "—"}</TableCell>
                        <TableCell>{inv.storeName ?? "Unmatched"}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(inv.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {inv.lineItemCount}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {invoices.length} of {total} invoices
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || isPending}
                    onClick={() => handlePage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || isPending}
                    onClick={() => handlePage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
