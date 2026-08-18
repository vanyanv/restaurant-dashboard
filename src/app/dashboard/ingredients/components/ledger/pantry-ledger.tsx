"use client"

import { Fragment, useCallback, useMemo, useState, useTransition } from "react"
import {
  getPantryIngredientHistory,
  type PantryIngredientHistory,
  type PantryLedgerData,
} from "@/app/actions/pantry-ledger-actions"
import { formatMoney } from "@/lib/pantry-format"
import { IngredientPanel } from "./ingredient-panel"
import { LedgerRow } from "./ledger-row"
import { ALL_FOOD, StationStrip, type StationFilter } from "./station-strip"

/**
 * The Pantry ledger.
 *
 * Twelve rows by default. The top 12 food rows are 91% of food spend, and the
 * live page's alternative — 76 equal-weight tiles sorted alphabetically — put
 * a 32%-of-spend ingredient in row 24 looking exactly like a $12 one.
 *
 * The hidden remainder is always named. Silent truncation reads as "this is
 * everything" when it isn't.
 */

const HEAD_ROWS = 12

type Props = {
  data: PantryLedgerData
}

export function PantryLedger({ data }: Props) {
  const [station, setStation] = useState<StationFilter>(ALL_FOOD)
  const [showAll, setShowAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, PantryIngredientHistory>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const pool = useMemo(
    () =>
      station === ALL_FOOD
        ? data.rows.filter((r) => !r.isPackaging)
        : data.rows.filter((r) => r.station === station),
    [data.rows, station]
  )

  const visible = showAll ? pool : pool.slice(0, HEAD_ROWS)
  const hidden = pool.length - visible.length
  const hiddenSpend = pool.slice(visible.length).reduce((s, r) => s + r.spend90, 0)
  const maxSpend = pool[0]?.spend90 ?? 1

  const selectStation = useCallback((next: StationFilter) => {
    setStation(next)
    setShowAll(false)
    setOpenId(null)
  }, [])

  const toggleRow = useCallback(
    (id: string) => {
      if (openId === id) {
        setOpenId(null)
        return
      }
      setOpenId(id)
      if (histories[id]) return

      setLoadingId(id)
      startTransition(async () => {
        try {
          const history = await getPantryIngredientHistory(id)
          setHistories((prev) => ({ ...prev, [id]: history }))
        } finally {
          setLoadingId((current) => (current === id ? null : current))
        }
      })
    },
    [histories, openId]
  )

  const label = station === ALL_FOOD ? "All food" : station

  return (
    <div className="px-8 py-6">
      <div className="pl-summary">
        <div className="pl-summary__cell">
          <span className="pl-summary__k">Purchased · 90 days</span>
          <span className="pl-summary__v">{formatMoney(data.totals.spend)}</span>
          <span className="pl-summary__n">across {data.totals.count} ingredients</span>
        </div>
        <div className="pl-summary__cell">
          <span className="pl-summary__k">Top five</span>
          <span className="pl-summary__v">
            {data.totals.spend > 0
              ? `${Math.round(
                  (data.rows.slice(0, 5).reduce((s, r) => s + r.spend90, 0) /
                    data.totals.spend) *
                    100
                )}%`
              : "—"}
          </span>
          <span className="pl-summary__n">
            {formatMoney(data.rows.slice(0, 5).reduce((s, r) => s + r.spend90, 0))} of the total
          </span>
        </div>
        <div className="pl-summary__cell">
          <span className="pl-summary__k">Food</span>
          <span className="pl-summary__v">{formatMoney(data.totals.foodSpend)}</span>
          <span className="pl-summary__n">{data.totals.foodCount} items</span>
        </div>
        <div className="pl-summary__cell">
          <span className="pl-summary__k">Packaging &amp; supplies</span>
          <span className="pl-summary__v">{formatMoney(data.totals.packagingSpend)}</span>
          <span className="pl-summary__n">{data.totals.packagingCount} items</span>
        </div>
      </div>

      <StationStrip
        stations={data.stations}
        foodCount={data.totals.foodCount}
        foodSpend={data.totals.foodSpend}
        totalSpend={data.totals.spend}
        selected={station}
        onSelect={selectStation}
      />

      <p className="pl-caption">
        {label} · sorted by 90-day spend ·{" "}
        {hidden > 0 ? `top ${visible.length} of ${pool.length}` : `all ${pool.length}`} shown
      </p>

      <div className="pl-scroller">
        <table className="pl-table">
          <thead>
            <tr>
              <th className="pl-th-left" colSpan={2}>
                Ingredient
              </th>
              <th>Unit price</th>
              <th>30-day change</th>
              <th>90-day spend</th>
              <th>Share of all</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const panelId = `pl-panel-${row.id}`
              const expanded = openId === row.id
              return (
                <Fragment key={row.id}>
                  <LedgerRow
                    row={row}
                    rank={index + 1}
                    maxSpend={maxSpend}
                    totalSpend={data.totals.spend}
                    expanded={expanded}
                    panelId={panelId}
                    onToggle={() => toggleRow(row.id)}
                  />
                  {expanded && (
                    <tr className="pl-detail" id={panelId}>
                      <td colSpan={6}>
                        <IngredientPanel
                          row={row}
                          history={histories[row.id] ?? null}
                          loading={loadingId === row.id}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {pool.length === 0 && (
        <p className="pl-none" style={{ marginTop: 16 }}>
          Nothing in {label}.
        </p>
      )}

      {pool.length > HEAD_ROWS && (
        <button
          type="button"
          className="pl-more"
          aria-expanded={showAll}
          onClick={() => {
            setShowAll((v) => !v)
            setOpenId(null)
          }}
        >
          {showAll ? "Show fewer" : `Show all ${pool.length}`}
          {!showAll && hidden > 0 && (
            <span className="pl-more__n">
              the other {hidden} are {formatMoney(hiddenSpend)}
            </span>
          )}
        </button>
      )}
    </div>
  )
}
