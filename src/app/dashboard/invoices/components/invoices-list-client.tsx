"use client"

import { useCallback, useRef, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, MapPin } from "lucide-react"
import type { InvoiceListItem } from "@/types/invoice"
import { formatCurrency, formatDateUS } from "@/lib/format"

const STATUS_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  APPROVED: "Approved",
  REVIEW: "Review",
  PENDING: "Pending",
  REJECTED: "Rejected",
}

interface InvoicesListClientProps {
  invoices: InvoiceListItem[]
  total: number
  page: number
  totalPages: number
}

export function InvoicesListClient({
  invoices,
  total,
  page,
  totalPages,
}: InvoicesListClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
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

  const handlePage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    if (nextPage <= 1) params.delete("page")
    else params.set("page", String(nextPage))
    const qs = params.toString()
    startTransition(() => {
      router.replace(
        qs ? `/dashboard/invoices?${qs}` : "/dashboard/invoices",
        { scroll: false }
      )
    })
  }

  if (invoices.length === 0) {
    return (
      <div className="inv-empty">
        <div className="inv-empty__mark">§</div>
        <p className="inv-empty__title">The ledger is empty</p>
        <p className="inv-empty__body">
          No invoices match your filters. Try a wider date range above, clear
          the filters, or sync fresh invoices from email.
        </p>
      </div>
    )
  }

  return (
    <section
      className="inv-list"
      style={{ opacity: isPending ? 0.7 : 1, pointerEvents: isPending ? "none" : undefined }}
    >
      <div className="inv-list__masthead" aria-hidden="true">
        <span />
        <span>Vendor</span>
        <span>Invoice date</span>
        <span>Store</span>
        <span>Total</span>
        <span>Status</span>
        <span />
      </div>

      <div role="list">
        {invoices.map((inv, i) => {
          const statusLabel = STATUS_LABELS[inv.status] ?? "Pending"
          return (
            <button
              key={inv.id}
              type="button"
              role="listitem"
              className={`inv-row dock-in dock-in-${Math.min(i + 1, 12)}`}
              onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
              onMouseEnter={() => prefetchInvoice(inv.id)}
              onFocus={() => prefetchInvoice(inv.id)}
              onTouchStart={() => prefetchInvoice(inv.id)}
              aria-label={`Open invoice ${inv.invoiceNumber} from ${inv.vendorName} for ${formatCurrency(inv.totalAmount)}`}
            >
              <span className="inv-row__folio">
                {String(i + 1 + (page - 1) * 25).padStart(3, "0")}
              </span>

              <span className="inv-row__vendor">
                <span className="inv-row__vendor-name">{inv.vendorName}</span>
                <span className="inv-row__vendor-meta">
                  <em>№ {inv.invoiceNumber}</em>
                  <span aria-hidden>·</span>
                  <span>
                    {inv.lineItemCount}{" "}
                    {inv.lineItemCount === 1 ? "item" : "items"}
                  </span>
                </span>
              </span>

              <span className="inv-row__date">
                {inv.invoiceDate ? formatDateUS(inv.invoiceDate) : "—"}
              </span>

              <span className="inv-row__store">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                {inv.storeName ? (
                  <span>{inv.storeName}</span>
                ) : (
                  <em>Unassigned</em>
                )}
              </span>

              <span className="inv-row__total total-num">
                {formatCurrency(inv.totalAmount)}
              </span>

              <span className="inv-row__status-cell">
                <span className="inv-stamp" data-status={inv.status}>
                  {statusLabel}
                </span>
              </span>

              <ChevronRight
                className="inv-row__chev h-4 w-4"
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>

      {totalPages > 1 ? (
        <div className="inv-pagination">
          <span>
            Folio {page} / {totalPages} · {total.toLocaleString()} total
          </span>
          <div className="inv-pagination__nav">
            <button
              type="button"
              className="inv-pagination__btn"
              disabled={page <= 1 || isPending}
              onClick={() => handlePage(page - 1)}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="inv-pagination__btn"
              disabled={page >= totalPages || isPending}
              onClick={() => handlePage(page + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
