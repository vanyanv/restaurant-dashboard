"use client"

import { useState } from "react"
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react"
import type { PriceAlert, OrderAnomaly } from "@/types/product-usage"

interface AlertsBannerProps {
  priceAlerts: PriceAlert[]
  orderAnomalies: OrderAnomaly[]
}

type Tone = "alert" | "watch" | "info" | "ok"

function priceAlertMeta(alert: PriceAlert): {
  Icon: typeof TrendingUp
  tone: Tone
  severityLabel: string
} {
  if (alert.severity === "decrease") {
    return { Icon: TrendingDown, tone: "ok", severityLabel: "Decrease" }
  }
  if (Math.abs(alert.changePercent) > 15) {
    return { Icon: AlertTriangle, tone: "alert", severityLabel: "High" }
  }
  return { Icon: TrendingUp, tone: "watch", severityLabel: "Watch" }
}

function anomalyMeta(anomaly: OrderAnomaly): {
  Icon: typeof Sparkles
  tone: Tone
  severityLabel: string
  typeLabel: string
} {
  if (anomaly.type === "new_product") {
    return {
      Icon: Sparkles,
      tone: "info",
      severityLabel: "New",
      typeLabel: "New product",
    }
  }
  if (anomaly.type === "quantity_spike") {
    return {
      Icon: Package,
      tone: "watch",
      severityLabel: "Spike",
      typeLabel: "Quantity spike",
    }
  }
  return {
    Icon: Package,
    tone: "info",
    severityLabel: "New",
    typeLabel: "New vendor",
  }
}

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

export function AlertsBanner({
  priceAlerts,
  orderAnomalies,
}: AlertsBannerProps) {
  // A first-time purchase is a catalogue event, not something to act on. Left
  // inline they outnumbered the real price movements roughly ten to one and
  // buried them — five things worth reading under fifty "first time ordering".
  // They stay available, one fold down.
  const newProducts = orderAnomalies.filter((a) => a.type === "new_product")
  const actionable = orderAnomalies.filter((a) => a.type !== "new_product")

  const totalAlerts = priceAlerts.length + actionable.length
  const [isOpen, setIsOpen] = useState(totalAlerts > 0)
  const [showNewProducts, setShowNewProducts] = useState(false)

  if (totalAlerts === 0 && newProducts.length === 0) return null

  return (
    <section className="inv-panel inv-panel--flush">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="inv-panel__dept">§ Alerts</span>
            <span
              className="font-display italic text-[18px]"
              style={{ color: "var(--ink)" }}
            >
              {totalAlerts === 0
                ? "Nothing to act on this period"
                : `${totalAlerts} alert${totalAlerts !== 1 ? "s" : ""} this period`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inv-stamp" data-tone="muted">
              {priceAlerts.length} price
            </span>
            <span className="inv-stamp" data-tone="muted">
              {actionable.length} order
            </span>
            {totalAlerts > 0 && (
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="toolbar-btn h-7 px-2"
                aria-expanded={isOpen}
                aria-label={isOpen ? "Collapse alerts" : "Expand alerts"}
              >
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {isOpen && (
        <div
          className="space-y-0"
          style={{ borderTop: "1px solid var(--hairline-bold)" }}
        >
          {priceAlerts.map((alert, idx) => {
            const meta = priceAlertMeta(alert)
            const Icon = meta.Icon
            return (
              <div
                key={`price-${idx}`}
                className="flex items-start gap-3 px-5 py-3"
                style={{
                  borderBottom:
                    idx === priceAlerts.length - 1 && orderAnomalies.length === 0
                      ? "none"
                      : "1px solid var(--hairline)",
                }}
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{
                    color:
                      meta.tone === "alert"
                        ? "var(--accent)"
                        : meta.tone === "watch"
                          ? "var(--subtract)"
                          : "var(--ink-muted)",
                  }}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[13px] font-medium truncate"
                      style={{ color: "var(--ink)" }}
                    >
                      {alert.productName}
                    </span>
                    <span className="inv-stamp" data-tone={meta.tone}>
                      {meta.severityLabel}
                    </span>
                    <span
                      className={`text-[11px] ${NUM_CLASS}`}
                      style={{
                        color:
                          meta.tone === "alert"
                            ? "var(--accent)"
                            : meta.tone === "watch"
                              ? "var(--subtract)"
                              : "var(--ink-muted)",
                      }}
                    >
                      {alert.changePercent > 0 ? "+" : ""}
                      {alert.changePercent.toFixed(1)}%
                    </span>
                  </div>
                  <p
                    className="text-[12px] mt-0.5"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {alert.message}
                  </p>
                </div>
              </div>
            )
          })}
          {actionable.map((anomaly, idx) => {
            const meta = anomalyMeta(anomaly)
            const Icon = meta.Icon
            return (
              <div
                key={`anomaly-${idx}`}
                className="flex items-start gap-3 px-5 py-3"
                style={{
                  borderBottom:
                    idx === actionable.length - 1
                      ? "none"
                      : "1px solid var(--hairline)",
                }}
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{
                    color:
                      meta.tone === "watch" ? "var(--subtract)" : "var(--ink-muted)",
                  }}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[13px] font-medium truncate"
                      style={{ color: "var(--ink)" }}
                    >
                      {anomaly.productName}
                    </span>
                    <span className="inv-stamp" data-tone={meta.tone}>
                      {meta.typeLabel}
                    </span>
                  </div>
                  <p
                    className="text-[12px] mt-0.5"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {anomaly.details}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {newProducts.length > 0 && (
        <div style={{ borderTop: "1px solid var(--hairline-bold)" }}>
          <button
            type="button"
            onClick={() => setShowNewProducts(!showNewProducts)}
            aria-expanded={showNewProducts}
            className="flex w-full items-center gap-3 px-5 py-3 text-left"
          >
            <Sparkles
              className="h-4 w-4 shrink-0"
              style={{ color: "var(--ink-muted)" }}
              aria-hidden
            />
            <span className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
              <span className={NUM_CLASS} style={{ color: "var(--ink)" }}>
                {newProducts.length}
              </span>{" "}
              product{newProducts.length !== 1 ? "s" : ""} ordered for the first
              time this period
            </span>
            <span className="ml-auto">
              {showNewProducts ? (
                <ChevronUp className="h-3.5 w-3.5" style={{ color: "var(--ink-muted)" }} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--ink-muted)" }} />
              )}
            </span>
          </button>

          {showNewProducts && (
            <ul
              className="px-5 pb-4 pt-1"
              style={{ columnWidth: "22rem", columnGap: "2rem" }}
            >
              {newProducts.map((anomaly, idx) => (
                <li
                  key={`new-${idx}`}
                  className="break-inside-avoid py-1 text-[12px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {anomaly.productName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
