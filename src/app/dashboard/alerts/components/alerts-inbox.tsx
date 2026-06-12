"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  acknowledgeAlert,
  dismissAlert,
  type AlertRow,
  type ListAlertsData,
} from "@/app/actions/alerts"

interface Props {
  data: ListAlertsData
}

const TARGET_LABEL: Record<string, string> = {
  REVENUE: "Revenue",
  MENU_ITEM: "Menu item",
  INGREDIENT: "Ingredient",
  LABOR: "Labor",
  REFUNDS: "Refunds",
  PRICE: "Price",
  PRODUCT: "Product",
}

const SOURCE_LABEL: Record<string, string> = {
  ANOMALY_EVENT: "anomaly",
  PRICE_DELTA: "price",
  HARRI_VARIANCE: "labor",
  QUANTITY_SPIKE: "spike",
  NEW_PRODUCT: "new",
}

function severityClass(severity: AlertRow["severity"]) {
  if (severity === "CRITICAL") return "text-[var(--accent)] font-semibold"
  if (severity === "WATCH") return "text-[var(--accent)]"
  return "text-[var(--ink-muted)]"
}

export function AlertsInbox({ data }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handle = (id: string, action: "ack" | "dismiss") => {
    setBusyId(id)
    startTransition(async () => {
      if (action === "ack") {
        await acknowledgeAlert({ alertId: id })
      } else {
        await dismissAlert({ alertId: id })
      }
      setBusyId(null)
      router.refresh()
    })
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Alert inbox</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {data.alerts.length} open · contextual
        </span>
      </header>

      {data.alerts.length === 0 ? (
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          No open alerts. Detections from the nightly pipeline land here — F12
          anomalies today, price and labor sources in upcoming phases.
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[80px_72px_72px_1fr_180px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Date</span>
            <span>Source</span>
            <span>Severity</span>
            <span>What</span>
            <span className="text-right">Action</span>
          </div>

          {data.alerts.map((a) => (
            <div
              key={a.id}
              className="order-row grid grid-cols-[80px_72px_72px_1fr_180px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)]"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {format(new Date(a.occurredOn), "MMM d")}
              </div>

              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                {SOURCE_LABEL[a.source] ?? a.source.toLowerCase()}
              </div>

              <div
                className={`font-mono text-[10px] uppercase tracking-[0.18em] ${severityClass(a.severity)}`}
              >
                {a.severity}
              </div>

              <div className="text-[14px] text-[var(--ink)] truncate">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mr-2">
                  {TARGET_LABEL[a.target] ?? a.target}
                </span>
                {a.storeName ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mr-2">
                    · {a.storeName}
                  </span>
                ) : null}
                <span>{a.title}</span>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => handle(a.id, "ack")}
                  disabled={isPending && busyId === a.id}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] hover:text-[var(--accent)] disabled:opacity-40"
                >
                  Acknowledge
                </button>
                <span className="font-mono text-[10px] text-[var(--ink-faint)]">·</span>
                <button
                  type="button"
                  onClick={() => handle(a.id, "dismiss")}
                  disabled={isPending && busyId === a.id}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] hover:text-[var(--accent)] disabled:opacity-40"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
