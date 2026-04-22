"use client"

import Link from "next/link"
import { AlertCircle, Receipt } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { RecipeCostLine } from "@/lib/recipe-cost"

/**
 * Small cost chip for a RecipeCostLine that also acts as a popover trigger
 * showing provenance (invoice vendor/SKU/date or "manual cost").
 *
 * - missingCost line       → red "Link to invoice" button
 * - component (sub-recipe) → plain $lineCost (no popover; dig into sub-recipe separately)
 * - ingredient line        → $lineCost + dashed chip + detail popover
 *
 * Extracted from src/app/dashboard/recipes/components/sortable-ingredient-row.tsx
 * so the same visual treatment can be reused in the menu catalog's detail sheet.
 */
export function ProvenanceChip({ line }: { line: RecipeCostLine }) {
  if (line.missingCost) {
    return (
      <Link
        href="/dashboard/ingredients?tab=review"
        className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent-dark)] hover:bg-[var(--accent)] hover:text-white"
      >
        <AlertCircle className="h-3 w-3" />
        Link to invoice
      </Link>
    )
  }

  if (line.kind === "component") {
    return (
      <span className="font-mono text-[11px] tabular-nums text-[var(--ink)]">
        ${line.lineCost.toFixed(2)}
      </span>
    )
  }

  const cost = `$${line.lineCost.toFixed(2)}`
  const isManual = line.costSource === "manual"
  const chipSuffix = isManual
    ? "manual"
    : [
        line.sourceSku ? `SKU ${line.sourceSku}` : null,
        line.sourceVendor ?? null,
        line.sourceInvoiceDate ? relativeTime(line.sourceInvoiceDate) : null,
      ]
        .filter(Boolean)
        .join(" · ") || "priced"

  const costUnit = line.costUnit ?? line.unit
  const mathLine =
    line.unitCost != null
      ? `${line.quantity} ${line.unit} × $${line.unitCost.toFixed(4)}/${costUnit} = $${line.lineCost.toFixed(4)}`
      : null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-2 text-right">
          <span className="font-mono text-[12px] tabular-nums text-[var(--ink)]">
            {cost}
          </span>
          <span className="hidden items-center gap-1 border border-dashed border-[var(--hairline-bold)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)] lg:inline-flex">
            {isManual ? <span>✏️</span> : <Receipt className="h-2.5 w-2.5" />}
            {chipSuffix}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 border border-(--ink)/80 bg-white p-3 font-mono text-[11px] shadow-[0_8px_24px_-8px_rgba(26,22,19,0.25)]"
        align="end"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[var(--ink-faint)]">
          {isManual ? (
            <span className="text-sm leading-none">✏️</span>
          ) : (
            <Receipt className="h-3 w-3" />
          )}
          <span className="uppercase tracking-[0.12em]">
            {isManual ? "Manual cost" : "Invoice provenance"}
          </span>
        </div>
        <dl className="space-y-1.5">
          {!isManual && (
            <>
              <Row k="Vendor" v={line.sourceVendor ?? "—"} />
              <Row k="SKU" v={line.sourceSku ?? "—"} />
              <Row
                k="Priced"
                v={line.sourceInvoiceDate ? formatDate(line.sourceInvoiceDate) : "—"}
              />
            </>
          )}
          <Row
            k="Unit cost"
            v={line.unitCost != null ? `$${line.unitCost.toFixed(4)}/${costUnit}` : "—"}
          />
          <Row k="Line" v={mathLine ?? `${line.quantity} ${line.unit} · ${cost}`} />
        </dl>
        {line.sourceInvoiceId && (
          <Link
            href={`/dashboard/invoices/${line.sourceInvoiceId}`}
            className="mt-3 inline-block border-b border-[var(--ink)] text-[var(--ink)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            Open source invoice →
          </Link>
        )}
        {isManual && (
          <Link
            href="/dashboard/ingredients"
            className="mt-3 inline-block border-b border-[var(--ink)] text-[var(--ink)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            Edit in catalog →
          </Link>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[var(--hairline)] pb-1 last:border-0">
      <dt className="uppercase tracking-[0.1em] text-[var(--ink-faint)]">{k}</dt>
      <dd className="truncate tabular-nums text-[var(--ink)]">{v}</dd>
    </div>
  )
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function relativeTime(d: Date): string {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.round(diff / 86400000)
  if (days < 1) return "today"
  if (days === 1) return "1d"
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}
