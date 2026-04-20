"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { BulletMeter } from "./bullet-meter"

export interface LeagueRow {
  storeId: string
  storeName: string
  grossSales: number
  cogsPct: number
  laborPct: number
  rentPct: number
  bottomLine: number
  marginPct: number
  fixedCostsConfigured: boolean
}

export interface PnLLeagueTableProps {
  rows: LeagueRow[]
  className?: string
  /** Target thresholds for the bullet meters. Tuned for a QSR / slider shop. */
  targets?: { cogs: number; labor: number; rent: number }
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `−$${str}` : `$${str}`
}

function formatPct(p: number): string {
  if (!Number.isFinite(p)) return "—"
  return `${(p * 100).toFixed(1)}%`
}

export function PnLLeagueTable({
  rows,
  className,
  targets = { cogs: 0.22, labor: 0.28, rent: 0.12 },
}: PnLLeagueTableProps) {
  if (rows.length === 0) {
    return null
  }

  // Rank by margin to stamp best/worst (only meaningful with 2+ rows)
  const ranked = [...rows]
    .map((r, originalIndex) => ({ ...r, originalIndex }))
    .sort((a, b) => b.marginPct - a.marginPct)
  const best = rows.length >= 2 ? ranked[0].storeId : null
  const worst = rows.length >= 2 ? ranked[ranked.length - 1].storeId : null

  return (
    <section className={cn("pnl-league", className)} aria-label="Store league">
      <div className="pnl-league__header">
        <span className="editorial-section-label">Store League</span>
        <span className="pnl-league__scope">
          {rows.length} location{rows.length === 1 ? "" : "s"} · ranked by margin
        </span>
      </div>

      <div className="pnl-league__grid" role="table">
        <div className="pnl-league__row pnl-league__row--head" role="row">
          <div className="pnl-league__cell pnl-league__cell--name" role="columnheader">
            Store
          </div>
          <div className="pnl-league__cell pnl-league__cell--num" role="columnheader">
            Gross
          </div>
          <div className="pnl-league__cell" role="columnheader">
            Food Cost
          </div>
          <div className="pnl-league__cell" role="columnheader">
            Labor
          </div>
          <div className="pnl-league__cell" role="columnheader">
            Rent
          </div>
          <div className="pnl-league__cell pnl-league__cell--num" role="columnheader">
            Bottom Line
          </div>
          <div className="pnl-league__cell pnl-league__cell--num" role="columnheader">
            Margin
          </div>
        </div>

        {rows.map((r) => {
          const stamp =
            r.storeId === best ? "best" : r.storeId === worst ? "worst" : null
          return (
            <Link
              key={r.storeId}
              href={`/dashboard/pnl/${r.storeId}`}
              className={cn(
                "pnl-league__row pnl-league__row--link",
                stamp === "best" && "pnl-league__row--best",
                stamp === "worst" && "pnl-league__row--worst"
              )}
              role="row"
            >
              <div className="pnl-league__cell pnl-league__cell--name" role="cell">
                <span className="pnl-league__name font-display">{r.storeName}</span>
                {stamp ? (
                  <span className={cn("pnl-league__stamp", `pnl-league__stamp--${stamp}`)}>
                    {stamp === "best" ? "Best" : "Watch"}
                  </span>
                ) : null}
                {!r.fixedCostsConfigured ? (
                  <span className="pnl-league__warn">· fixed costs not set</span>
                ) : null}
              </div>

              <div className="pnl-league__cell pnl-league__cell--num" role="cell">
                <span className="font-mono">{formatDollar(r.grossSales)}</span>
              </div>

              <div className="pnl-league__cell pnl-league__cell--meter" role="cell">
                <BulletMeter
                  value={r.cogsPct}
                  target={targets.cogs}
                  ariaLabel={`Food cost ${formatPct(r.cogsPct)} vs target ${formatPct(targets.cogs)}`}
                />
                <span className="pnl-league__pct font-mono">{formatPct(r.cogsPct)}</span>
              </div>

              <div className="pnl-league__cell pnl-league__cell--meter" role="cell">
                <BulletMeter
                  value={r.laborPct}
                  target={targets.labor}
                  ariaLabel={`Labor ${formatPct(r.laborPct)} vs target ${formatPct(targets.labor)}`}
                />
                <span className="pnl-league__pct font-mono">{formatPct(r.laborPct)}</span>
              </div>

              <div className="pnl-league__cell pnl-league__cell--meter" role="cell">
                <BulletMeter
                  value={r.rentPct}
                  target={targets.rent}
                  ariaLabel={`Rent ${formatPct(r.rentPct)} vs target ${formatPct(targets.rent)}`}
                />
                <span className="pnl-league__pct font-mono">{formatPct(r.rentPct)}</span>
              </div>

              <div className="pnl-league__cell pnl-league__cell--num" role="cell">
                <span className="font-mono pnl-league__bottomline">
                  {formatDollar(r.bottomLine)}
                </span>
              </div>

              <div className="pnl-league__cell pnl-league__cell--num" role="cell">
                <span
                  className={cn(
                    "font-mono",
                    r.marginPct < 0 && "pnl-league__negative"
                  )}
                >
                  {formatPct(r.marginPct)}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
