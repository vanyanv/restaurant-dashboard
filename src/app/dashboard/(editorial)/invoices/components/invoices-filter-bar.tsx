"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

interface InvoicesFilterBarProps {
  vendor: string
  status: string
  total: number
  needsReview: number
}

const STATUS_CHIPS: Array<{
  key: string
  label: string
  variant?: "review"
}> = [
  { key: "all", label: "All" },
  { key: "REVIEW", label: "Needs Review", variant: "review" },
  { key: "MATCHED", label: "Matched" },
  { key: "APPROVED", label: "Approved" },
  { key: "PENDING", label: "Pending" },
  { key: "REJECTED", label: "Rejected" },
]

export function InvoicesFilterBar({
  vendor,
  status,
  total,
  needsReview,
}: InvoicesFilterBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [vendorQuery, setVendorQuery] = useState(vendor)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setVendorQuery(vendor)
  }, [vendor])

  const pushFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.delete("page")
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "" || v === "all") params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(
        qs ? `/dashboard/invoices?${qs}` : "/dashboard/invoices",
        { scroll: false }
      )
    })
  }

  const handleVendorChange = (value: string) => {
    setVendorQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      pushFilters({ vendor: value || null })
    }, 280)
  }

  const handleStatusChange = (key: string) => {
    pushFilters({ status: key === "all" ? null : key })
  }

  const currentStatus = status || "all"
  const hasActiveFilters = vendorQuery.length > 0 || currentStatus !== "all"

  return (
    <section
      className="inv-panel inv-toolbar"
      aria-label="Invoice filters"
      style={{ opacity: isPending ? 0.75 : 1 }}
    >
      <div className="inv-toolbar__top">
        <div className="inv-toolbar__search">
          <Search className="h-4 w-4" aria-hidden="true" />
          <input
            type="text"
            inputMode="search"
            placeholder="Search by vendor…"
            value={vendorQuery}
            onChange={(e) => handleVendorChange(e.target.value)}
            aria-label="Search vendor"
          />
          {vendorQuery ? (
            <button
              type="button"
              className="clear"
              onClick={() => handleVendorChange("")}
              aria-label="Clear vendor search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="inv-toolbar__count">
          <span>
            {total.toLocaleString()} {total === 1 ? "invoice" : "invoices"}
          </span>
          {needsReview > 0 ? (
            <button
              type="button"
              className="inv-toolbar__alert"
              onClick={() => handleStatusChange("REVIEW")}
            >
              {needsReview} need review
            </button>
          ) : null}
          {hasActiveFilters ? (
            <button
              type="button"
              className="inv-toolbar__clear"
              onClick={() => {
                setVendorQuery("")
                pushFilters({ vendor: null, status: null })
              }}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      <div className="inv-toolbar__status" role="radiogroup" aria-label="Status filter">
        <span className="inv-toolbar__status-label">Status</span>
        {STATUS_CHIPS.map((chip) => {
          const active = currentStatus === chip.key
          return (
            <button
              key={chip.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => handleStatusChange(chip.key)}
              disabled={isPending}
              className="inv-status-chip"
              data-active={active || undefined}
              data-variant={chip.variant}
            >
              {chip.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
