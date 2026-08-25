"use client"

import { formatUnitPrice, isMaterialImpact } from "@/lib/pantry-format"
import { prettifyIngredientName } from "../../../recipes/components/ingredient-picker-utils"
import type { PantryLedgerRow } from "@/app/actions/pantry-ledger-actions"

/**
 * One summary row of the ledger.
 *
 * The 30-day column shows a percentage quietly and the dollars loudly, and
 * only earns red when the move is worth $250 a quarter or more. On the live
 * page a +45% move on the fry programme and a +5% move on sanitizer carry
 * identical chips; they are worth $7,299 and $26.
 */

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

type Props = {
  row: PantryLedgerRow
  rank: number
  /** Widest spend in the current view, for the share bar. */
  maxSpend: number
  /** Denominator for the share percentage — total spend across everything. */
  totalSpend: number
  expanded: boolean
  panelId: string
  onToggle: () => void
}

export function LedgerRow({
  row,
  rank,
  maxSpend,
  totalSpend,
  expanded,
  panelId,
  onToggle,
}: Props) {
  const material = isMaterialImpact(row.impact90)
  const pct = row.trend30d?.pctChange ?? null
  const up = (pct ?? 0) > 0
  const share = totalSpend > 0 ? (row.spend90 / totalSpend) * 100 : 0
  const unitPrice = formatUnitPrice(row.costPerRecipeUnit ?? row.latestUnitCost)
  const unit = row.recipeUnit ?? row.latestUnit ?? row.defaultUnit

  const flags: string[] = []
  if (row.costPerRecipeUnit == null && row.latestUnitCost == null) flags.push("no price")
  if (row.spend90 === 0) flags.push("not bought")

  // A multi-SKU ingredient is the warning that matters most: it means the
  // trend in this very row is comparing different products.
  const source =
    row.skuCount > 1
      ? `${row.skuCount} products`
      : row.vendors.length > 1
        ? `${row.vendors.length} vendors`
        : (row.vendors[0] ?? row.latestVendor ?? "")

  return (
    <tr className="pl-row">
      <td className="pl-rank">{String(rank).padStart(2, "0")}</td>

      <td className="pl-name">
        <button
          type="button"
          className="pl-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="pl-title">
            {prettifyIngredientName(row.name)}
            <span className="pl-chev" aria-hidden />
          </span>
          <span className="pl-meta">
            <span className="pl-meta__station">{row.station}</span>
            {source && (
              <>
                {" · "}
                <span className={row.skuCount > 1 ? "pl-meta__warn" : undefined}>{source}</span>
              </>
            )}
            {row.recipeUseCount > 0 && ` · ${row.recipeUseCount} recipe${row.recipeUseCount === 1 ? "" : "s"}`}
            {flags.map((f) => (
              <span key={f} className="pl-flag">
                {f}
              </span>
            ))}
          </span>
        </button>
      </td>

      <td className="pl-unit">
        {unitPrice ? (
          <>
            {unitPrice}
            <span className="pl-unit__suffix">/{unit}</span>
          </>
        ) : (
          <span className="pl-quiet">—</span>
        )}
      </td>

      <td className="pl-delta">
        {pct == null || Math.abs(pct) < 0.5 ? (
          <span className="pl-quiet">—</span>
        ) : material && row.impact90 != null ? (
          <span className={`pl-delta__wrap ${up ? "pl-delta--up" : "pl-delta--down"}`}>
            <span className="pl-delta__pct">
              {up ? "+" : "−"}
              {Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%
            </span>
            <span className="pl-delta__amt">
              {up ? "+" : "−"}
              {money(Math.abs(row.impact90))}
            </span>
          </span>
        ) : (
          <span className="pl-delta__wrap">
            <span className="pl-delta__pct">
              {up ? "+" : "−"}
              {Math.abs(pct).toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%
            </span>
          </span>
        )}
      </td>

      <td className="pl-spend">
        {row.spend90 > 0 ? money(row.spend90) : <span className="pl-quiet">—</span>}
      </td>

      <td className="pl-share">
        <span className="pl-bar">
          <i style={{ width: `${maxSpend > 0 ? (row.spend90 / maxSpend) * 100 : 0}%` }} />
        </span>
        <span className="pl-share__pct">{share >= 0.1 ? `${share.toFixed(1)}%` : ""}</span>
      </td>
    </tr>
  )
}
