"use client"

import { useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/format"
import type { PriceAlert } from "@/types/product-usage"

interface PriceChangesTableProps {
  data: PriceAlert[]
}

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

function changeColor(pct: number): string {
  if (pct > 5) return "var(--accent)"
  if (pct > 0) return "var(--subtract)"
  return "var(--ink)"
}

function SeverityStamp({ severity, pct }: { severity: PriceAlert["severity"]; pct: number }) {
  if (severity === "spike") {
    return <span className="inv-stamp" data-tone="alert">Alert</span>
  }
  if (severity === "increase") {
    return <span className="inv-stamp" data-tone="watch">Watch</span>
  }
  if (pct < -5) {
    return <span className="inv-stamp" data-tone="info">Decrease</span>
  }
  return <span className="inv-stamp" data-tone="ok">Stable</span>
}

export function PriceChangesTable({ data }: PriceChangesTableProps) {
  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)
      ),
    [data]
  )

  const headStyle = { color: "var(--ink-faint)" } as const

  return (
    <section className="inv-panel inv-panel--flush">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <div>
          <span className="inv-panel__dept">§ Vendors</span>
          <p
            className="font-display italic text-[18px] mt-0.5"
            style={{ color: "var(--ink)" }}
          >
            Price changes{" "}
            <span style={{ color: "var(--ink-faint)" }}>· {data.length} products</span>
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Recent movements vs the 30-day average.
          </p>
        </div>
      </div>
      {/* Mobile: change-% leads (the whole point of the panel — flagging
          movement). Avg → latest sits below as a price arc. */}
      <ul
        className="sm:hidden"
        style={{ borderTop: "1px solid var(--hairline-bold)" }}
      >
        {sorted.length === 0 ? (
          <li
            className="px-4 py-12 text-center text-[13px]"
            style={{ color: "var(--ink-muted)" }}
          >
            No price changes detected.
          </li>
        ) : (
          sorted.map((alert, idx) => (
            <li
              key={`${alert.productName}-${idx}`}
              className="px-4 py-3"
              style={{ borderTop: "1px solid var(--hairline)" }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="font-display italic text-[16px] leading-tight"
                  style={{
                    color: "var(--ink)",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {alert.productName}
                </span>
                <SeverityStamp
                  severity={alert.severity}
                  pct={alert.changePercent}
                />
              </div>
              {alert.category && (
                <div
                  className="mt-1"
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-muted)",
                  }}
                >
                  {alert.category}
                </div>
              )}
              <div
                className="mt-2 flex items-baseline justify-between gap-3"
                style={{
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  fontVariantNumeric: "tabular-nums lining-nums",
                }}
              >
                <span
                  className="text-[12.5px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {formatCurrency(alert.previousAvgPrice)}
                  <span aria-hidden style={{ margin: "0 6px" }}>→</span>
                  <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {formatCurrency(alert.currentPrice)}
                  </span>
                </span>
                <span
                  className="text-[18px] font-semibold"
                  style={{ color: changeColor(alert.changePercent) }}
                >
                  {alert.changePercent > 0 ? "+" : ""}
                  {alert.changePercent.toFixed(1)}%
                </span>
              </div>
            </li>
          ))
        )}
      </ul>

      <div
        className="hidden sm:block max-h-125 overflow-auto"
        style={{ borderTop: "1px solid var(--hairline-bold)" }}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10" style={{ background: "var(--paper)" }}>
            <TableRow style={{ borderBottom: "1px solid var(--hairline)" }}>
              <TableHead className="pl-4" style={headStyle}>Product</TableHead>
              <TableHead className="pl-4" style={headStyle}>Category</TableHead>
              <TableHead className="pl-4" style={headStyle}>30d avg</TableHead>
              <TableHead className="pl-4" style={headStyle}>Latest</TableHead>
              <TableHead className="pl-4" style={headStyle}>Change</TableHead>
              <TableHead className="pl-4" style={headStyle}>Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length > 0 ? (
              sorted.map((alert, idx) => (
                <TableRow
                  key={`${alert.productName}-${idx}`}
                  className="editorial-tr"
                  style={{ borderBottom: "1px solid var(--hairline)" }}
                >
                  <TableCell className="pl-4 text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                    {alert.productName}
                  </TableCell>
                  <TableCell className="pl-4">
                    {alert.category ? (
                      <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                        {alert.category}
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>·</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`pl-4 text-[13px] ${NUM_CLASS}`}
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {formatCurrency(alert.previousAvgPrice)}
                  </TableCell>
                  <TableCell
                    className={`pl-4 text-[13px] ${NUM_CLASS}`}
                    style={{ color: "var(--ink)" }}
                  >
                    {formatCurrency(alert.currentPrice)}
                  </TableCell>
                  <TableCell className="pl-4">
                    <span
                      className={`text-[13px] font-semibold ${NUM_CLASS}`}
                      style={{ color: changeColor(alert.changePercent) }}
                    >
                      {alert.changePercent > 0 ? "+" : ""}
                      {alert.changePercent.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="pl-4">
                    <SeverityStamp
                      severity={alert.severity}
                      pct={alert.changePercent}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-[13px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  No price changes detected.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
