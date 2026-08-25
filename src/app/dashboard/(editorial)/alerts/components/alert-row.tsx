"use client"

import { useState, useTransition } from "react"
import {
  acknowledgeAlert,
  dismissAlert,
  type InboxAlert,
} from "@/app/actions/alerts/inbox-actions"

/**
 * One alert in the inbox. `.stack-row` carries the same interaction contract as
 * `.inv-row` (red 4px accent bar, warm wash) without the invoice ledger's
 * seven-column grid, which an alert's headline-plus-prose shape does not fit.
 *
 * Severity carries a mono word as well as a colour — the monitoring panels'
 * habit of encoding a threshold breach as red alone is the thing this inbox
 * is meant to replace, not repeat.
 */

const SEVERITY_LABEL: Record<InboxAlert["severity"], string> = {
  CRITICAL: "Critical",
  WATCH: "Watch",
  INFO: "Note",
}

const SOURCE_LABEL: Record<InboxAlert["source"], string> = {
  ANOMALY_EVENT: "Anomaly",
  PRICE_DELTA: "Price move",
  HARRI_VARIANCE: "Labor variance",
  QUANTITY_SPIKE: "Quantity spike",
  NEW_PRODUCT: "New product",
}

function severityColor(severity: InboxAlert["severity"]): string {
  return severity === "CRITICAL"
    ? "var(--accent)"
    : severity === "WATCH"
      ? "var(--subtract)"
      : "var(--ink-muted)"
}

export function AlertRow({
  alert,
  showStore,
}: {
  alert: InboxAlert
  showStore: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState("")
  const [resolved, setResolved] = useState<string | null>(null)

  function act(fn: () => Promise<unknown>, label: string) {
    startTransition(async () => {
      await fn()
      setResolved(label)
    })
  }

  if (resolved) {
    return (
      <div className="stack-row" data-resolved="true">
        <span className="text-[13px] text-(--ink-muted)">
          {alert.title} — <em>{resolved}</em>
        </span>
      </div>
    )
  }

  return (
    <article className="stack-row" data-severity={alert.severity}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="font-mono text-[9.5px] uppercase tracking-[0.18em]"
          style={{ color: severityColor(alert.severity) }}
        >
          {SEVERITY_LABEL[alert.severity]}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-muted)">
          {SOURCE_LABEL[alert.source]}
        </span>
        <span className="text-[14px] font-medium text-(--ink)">{alert.title}</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-(--ink-muted)">
          {alert.occurredOn.toISOString().slice(0, 10)}
          {showStore ? ` · ${alert.storeName}` : ""}
        </span>
      </div>

      {alert.body ? (
        <p className="mt-1 max-w-[80ch] text-[13px] leading-6 text-(--ink-muted)">
          {alert.body}
        </p>
      ) : null}

      {explaining ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            act(
              () => acknowledgeAlert({ alertId: alert.id, explanation }),
              "explained",
            )
          }}
        >
          <input
            autoFocus
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="What was it? e.g. supplier return"
            aria-label={`Explanation for ${alert.title}`}
            className="h-8 min-w-[18rem] flex-1 border border-(--hairline-bold) bg-(--paper-soft) px-2 text-[13px] outline-none focus-visible:border-(--accent)"
          />
          <button type="submit" className="toolbar-btn" disabled={pending}>
            Save
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setExplaining(false)}
            disabled={pending}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="toolbar-btn"
            disabled={pending}
            onClick={() =>
              act(() => acknowledgeAlert({ alertId: alert.id }), "acknowledged")
            }
          >
            Acknowledge
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={pending}
            onClick={() => setExplaining(true)}
          >
            Explain
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={pending}
            onClick={() => act(() => dismissAlert({ alertId: alert.id }), "dismissed")}
          >
            Dismiss
          </button>
        </div>
      )}
    </article>
  )
}
