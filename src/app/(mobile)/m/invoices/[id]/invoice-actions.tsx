"use client"

import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "PENDING", label: "Pending" },
  { value: "MATCHED", label: "Matched" },
  { value: "REVIEW", label: "Review" },
  { value: "APPROVED", label: "Approve" },
  { value: "REJECTED", label: "Reject" },
]

type Props = {
  invoiceId: string
  currentStatus: string
  currentStoreId: string | null
  stores: Array<{ id: string; name: string }>
}

export function InvoiceActions({
  invoiceId,
  currentStatus,
  currentStoreId,
  stores,
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState(currentStatus)
  const [storeId, setStoreId] = useState(currentStoreId ?? "")
  const [pending, start] = useTransition()

  function patch(body: Record<string, unknown>, msg: string) {
    start(async () => {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        toast.success(msg)
        router.refresh()
      } else {
        toast.error("Update failed")
      }
    })
  }

  function setStatusAction(next: string) {
    setStatus(next)
    patch({ status: next }, `Marked ${next.toLowerCase()}`)
  }

  function setStoreAction(next: string) {
    setStoreId(next)
    patch(
      {
        storeId: next || null,
        status: next ? "MATCHED" : "PENDING",
      },
      next ? "Store assigned" : "Store cleared"
    )
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <fieldset
        style={{ display: "grid", gap: 8, border: 0, padding: 0, margin: 0 }}
      >
        <legend className="m-cap" style={{ padding: 0 }}>
          Status
        </legend>
        <div
          role="radiogroup"
          aria-label="Invoice status"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
          }}
        >
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={pending}
                className={`toolbar-btn${active ? " active" : ""}`}
                onClick={() => setStatusAction(opt.value)}
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "10px 6px",
                  fontSize: 12,
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div style={{ display: "grid", gap: 8 }}>
        <label
          className="m-cap"
          htmlFor={`store-${invoiceId}`}
          style={{ display: "block" }}
        >
          Store
        </label>
        <select
          id={`store-${invoiceId}`}
          className="m-select"
          value={storeId}
          disabled={pending}
          onChange={(e) => setStoreAction(e.target.value)}
        >
          <option value="">Unassigned</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
