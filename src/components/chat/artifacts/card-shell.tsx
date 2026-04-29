"use client"

import { useState, type ReactNode } from "react"

interface CardShellProps {
  /** Department-tag mono label, e.g. "INVOICE", "RECIPE", "TOP INVOICES". */
  dept: string
  /** Headline rendered to the right of the dept tag. Plain text — DM Sans
   *  tabular for sums, Fraunces italic when it's an entity name. */
  headline: ReactNode
  /** Optional secondary line below the headline (vendor, store, dates). */
  subline?: ReactNode
  /** Optional toggle slot rendered to the right of the headline (e.g. the
   *  Table │ Chart switch on a TrendCard). */
  rightSlot?: ReactNode
  /** Footer link, typically "Open in dashboard". */
  footerHref?: string
  footerLabel?: string
  /** Default open state. Single-entity cards default to true; multi-row
   *  cards default to false when row count is high. */
  defaultOpen?: boolean
  /** When true, the card frame paints a red proofmark left-bar — used to
   *  mark the entity the assistant's prose is answering about (e.g. the
   *  biggest invoice, the best-net store). */
  isHighlighted?: boolean
  children: ReactNode
}

/**
 * Shared frame for every chat artifact. `.inv-panel`-class register:
 * `1px solid var(--hairline-bold)` border, `2px` radius, warm-paper ground,
 * no shadow. Body uses the same `grid-template-rows: 0fr → 1fr` reveal as
 * the (now-removed) tool-trace expander so the toggle never animates
 * height — a pattern that's reduced-motion-safe via the global
 * `@media (prefers-reduced-motion)` block in chat.css.
 */
export function CardShell({
  dept,
  headline,
  subline,
  rightSlot,
  footerHref,
  footerLabel = "Open in dashboard",
  defaultOpen = true,
  isHighlighted = false,
  children,
}: CardShellProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className={
        "chat-artifact" +
        (open ? " is-open" : "") +
        (isHighlighted ? " is-highlighted" : "")
      }
    >
      <div className="chat-artifact__head">
        <button
          type="button"
          className="chat-artifact__head-btn"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="chat-artifact__dept">{dept}</span>
          <span className="chat-artifact__headline">{headline}</span>
          <span className="chat-artifact__chevron" aria-hidden>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3.5,2 6.5,5 3.5,8" />
            </svg>
          </span>
        </button>
        {rightSlot ? (
          <span className="chat-artifact__right">{rightSlot}</span>
        ) : null}
      </div>
      {subline ? <div className="chat-artifact__subline">{subline}</div> : null}
      <div className="chat-artifact__body" aria-hidden={!open}>
        <div className="chat-artifact__body-inner">
          {children}
          {footerHref ? (
            <div className="chat-artifact__footer">
              <a href={footerHref} className="chat-artifact__footer-link">
                {footerLabel}
                <span aria-hidden>→</span>
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Tabular-numerics span. Cards use this for any cell that holds a money,
 *  count, or percent so the dashboard's two-tier type rule holds. */
export function Num({ children }: { children: ReactNode }) {
  return <span className="chat-artifact__num">{children}</span>
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  const abs = Math.abs(n)
  return (
    (n < 0 ? "−" : "") +
    "$" +
    abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return Math.round(n).toLocaleString()
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return `${(n * 100).toFixed(digits)}%`
}

export function fmtSignedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  if (n === 0) return "$0.00"
  return (n > 0 ? "+" : "") + fmtMoney(n)
}
