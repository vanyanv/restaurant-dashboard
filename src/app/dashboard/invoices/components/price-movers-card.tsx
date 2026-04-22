"use client"

import Link from "next/link"
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDateUS } from "@/lib/format"
import type { PriceMoverRow } from "@/types/invoice"

interface PriceMoversCardProps {
  rows: PriceMoverRow[]
}

export function PriceMoversCard({ rows }: PriceMoversCardProps) {
  const increases = rows.filter((r) => r.pctChange > 0).length
  const decreases = rows.filter((r) => r.pctChange < 0).length

  return (
    <section className="inv-panel mv-panel">
      <div className="inv-panel__head">
        <div className="flex items-baseline gap-3">
          <div className="inv-panel__dept">§ price movers</div>
          <h3 className="inv-panel__title">What shifted</h3>
        </div>
        <div className="flex items-center gap-2">
          {increases > 0 && (
            <span className="inv-stamp" data-status="REVIEW">
              <ArrowUpRight className="h-3 w-3" />
              {increases} up
            </span>
          )}
          {decreases > 0 && (
            <span
              className="inv-stamp"
              data-status="MATCHED"
              style={{ color: "#3f5e1a" }}
            >
              <ArrowDownRight className="h-3 w-3" />
              {decreases} down
            </span>
          )}
        </div>
      </div>

      <p className="-mt-2 mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        unit price changed ≥5% from the prior order · last 90 days
      </p>

      {rows.length === 0 ? (
        <div className="inv-empty">
          <div className="inv-empty__mark">·</div>
          <div className="inv-empty__title">Prices have been quiet.</div>
          <p className="inv-empty__body">
            No unit-price changes above 5% in the last 90 days. Check back after
            the next invoice run.
          </p>
        </div>
      ) : (
        <div className="-mx-5 -mb-4 overflow-x-auto">
          {rows.map((r, i) => (
            <MoverRow key={`${r.vendorName}-${r.canonicalIngredientId ?? r.sku ?? r.productName}-${i}`} row={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function MoverRow({ row }: { row: PriceMoverRow }) {
  const up = row.pctChange > 0
  const displayName = row.canonicalName ?? row.productName
  const meta: string[] = []
  if (row.canonicalName) meta.push("ingredient rollup")
  if (row.sku) meta.push(`SKU ${row.sku}`)
  if (row.unit) meta.push(row.unit)
  if (row.sampleCount > 2) meta.push(`${row.sampleCount} invoices`)

  const changeLabel = `${up ? "+" : ""}${row.pctChange.toFixed(row.pctChange >= 10 || row.pctChange <= -10 ? 0 : 1)}%`

  const content = (
    <>
      <span className="mv-row__product">
        <span className="mv-row__name" title={displayName}>
          {displayName}
        </span>
        {meta.length > 0 && (
          <span className="mv-row__meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden>·</span>}
                {m.startsWith("ingredient") ? <em>{m}</em> : m}
              </span>
            ))}
          </span>
        )}
        <span className="mv-row__vendor" title={row.vendorName}>
          <span className="mv-row__vendor-label" aria-hidden>
            from
          </span>
          {row.vendorName}
        </span>
      </span>
      <span className="mv-row__price">
        {formatCurrency(row.prevPrice)}
        <span className="mv-row__price-date">{formatDateUS(row.prevDate)}</span>
      </span>
      <span className="mv-row__arrow" aria-hidden>
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
      <span className="mv-row__price mv-row__price--latest">
        {formatCurrency(row.latestPrice)}
        <span className="mv-row__price-date">{formatDateUS(row.latestDate)}</span>
      </span>
      <span
        className={cn(
          "mv-row__change",
          up ? "mv-row__change--up" : "mv-row__change--down"
        )}
      >
        {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        {changeLabel}
      </span>
      <ChevronRight className="mv-row__chev h-4 w-4" />
    </>
  )

  if (row.canonicalIngredientId) {
    return (
      <Link
        href={`/dashboard/ingredients?open=${row.canonicalIngredientId}`}
        className="mv-row mv-row--button"
      >
        {content}
      </Link>
    )
  }

  return <div className="mv-row">{content}</div>
}
