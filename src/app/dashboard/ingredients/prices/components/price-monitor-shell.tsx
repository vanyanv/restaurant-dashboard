"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Check, ChevronRight, Lock, Search, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { prettifyIngredientName } from "@/app/dashboard/recipes/components/ingredient-picker-utils"
import type {
  IngredientPriceIssueStatus,
  IngredientPriceMonitoringData,
  IngredientPriceMonitorPoint,
  IngredientPriceMonitorRow,
} from "@/types/ingredient-price-monitor"

type Props = {
  data: IngredientPriceMonitoringData
  filters: {
    category?: string
    status?: string
  }
}

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "moved", label: "Moved" },
  { key: "locked", label: "Locked" },
  { key: "stale", label: "Stale" },
]

function money(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a"
  return `$${value.toFixed(value < 1 ? 4 : digits)}`
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a"
  const abs = Math.abs(value)
  return `${value > 0 ? "+" : ""}${value.toFixed(abs >= 10 ? 0 : 1)}%`
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "n/a"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export function PriceMonitorShell({ data, filters }: Props) {
  const [selectedId, setSelectedId] = useState(
    data.rows[0]?.canonicalIngredientId ?? null
  )
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState(filters.status ?? "all")
  const [category, setCategory] = useState(filters.category ?? "all")

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of data.rows) {
      map.set("all", (map.get("all") ?? 0) + 1)
      if (row.status === "no-recipe-unit" || row.status === "conversion-issue" || row.status === "unpriced") {
        map.set("review", (map.get("review") ?? 0) + 1)
      }
      if (row.change30dPct != null && Math.abs(row.change30dPct) >= 5) {
        map.set("moved", (map.get("moved") ?? 0) + 1)
      }
      map.set(row.status, (map.get(row.status) ?? 0) + 1)
    }
    return map
  }, [data.rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.rows.filter((row) => {
      if (category !== "all" && row.category !== category) return false
      if (status === "review") {
        if (!["no-recipe-unit", "conversion-issue", "unpriced"].includes(row.status)) return false
      } else if (status === "moved") {
        if (row.change30dPct == null || Math.abs(row.change30dPct) < 5) return false
      } else if (status !== "all" && row.status !== status) {
        return false
      }
      if (q) {
        const haystack = `${row.name} ${row.category ?? ""} ${row.latestInvoiceVendor ?? ""} ${row.latestInvoiceSku ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [category, data.rows, query, status])

  const selected =
    filtered.find((row) => row.canonicalIngredientId === selectedId) ??
    filtered[0] ??
    data.rows.find((row) => row.canonicalIngredientId === selectedId) ??
    null

  return (
    <div className="price-monitor">
      <section className="inv-kpis dock-in dock-in-1" aria-label="Ingredient price KPIs">
        <Kpi folio="MATCH" label="Invoice matching" value={`${data.kpis.matchedPct}%`} sub={`${data.kpis.matchedLineItems}/${data.kpis.recentLineItems} recent lines`} />
        <Kpi folio="FLOW" label="Updated ingredients" value={data.kpis.updatedIngredients.toLocaleString()} sub={`priced in last ${data.days} days`} />
        <Kpi folio="LOCK" label="Locked costs" value={data.kpis.lockedIngredients.toLocaleString()} sub="manual prices held" alert={data.kpis.lockedIngredients > 0} />
        <Kpi folio="REVIEW" label="Conversion issues" value={data.kpis.conversionIssues.toLocaleString()} sub={`${data.kpis.staleCosts} stale costs`} alert={data.kpis.conversionIssues > 0} />
      </section>

      <section className="inv-panel dock-in dock-in-2">
        <div className="inv-panel__head">
          <div>
            <div className="inv-panel__dept">Monitor</div>
            <h2 className="inv-panel__title">Ingredient price ledger</h2>
          </div>
          <div className="price-monitor-count">
            {filtered.length} / {data.rows.length} rows
          </div>
        </div>

        <div className="inv-toolbar">
          <div className="inv-toolbar__top">
            <label className="inv-toolbar__search">
              <Search className="h-4 w-4" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ingredient, vendor, SKU"
              />
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="price-monitor-select"
              aria-label="Category"
            >
              <option value="all">All categories</option>
              {data.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="inv-toolbar__status">
            <span className="inv-toolbar__status-label">Status</span>
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="inv-status-chip"
                data-active={status === item.key}
                data-variant={item.key === "review" ? "review" : undefined}
                onClick={() => setStatus(item.key)}
              >
                {item.label}
                <span className="tabular-nums">{counts.get(item.key) ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="price-monitor-grid dock-in dock-in-3">
        <section className="inv-panel inv-panel--flush price-monitor-ledger">
          <div className="price-monitor-masthead" aria-hidden>
            <span>Ingredient</span>
            <span>Current</span>
            <span>Latest invoice</span>
            <span>30d</span>
            <span>Status</span>
            <span />
          </div>
          {filtered.length === 0 ? (
            <EmptyState hasRows={data.rows.length > 0} />
          ) : (
            filtered.map((row) => (
              <button
                key={row.canonicalIngredientId}
                type="button"
                className={cn(
                  "inv-row price-monitor-row",
                  selected?.canonicalIngredientId === row.canonicalIngredientId && "is-selected"
                )}
                onClick={() => setSelectedId(row.canonicalIngredientId)}
                aria-pressed={selected?.canonicalIngredientId === row.canonicalIngredientId}
              >
                <span className="price-monitor-row__name">
                  <strong>{prettifyIngredientName(row.name)}</strong>
                  <em>{row.category ?? "uncategorized"} · {row.recipeUsageCount} recipes</em>
                </span>
                <span className="inv-row__total price-monitor-row__cost">
                  {money(row.currentNormalizedCost)}
                  <em>/{row.currentUnit ?? row.recipeUnit ?? "unit"}</em>
                </span>
                <span className="price-monitor-row__invoice">
                  <strong>{row.latestInvoiceVendor ?? "No vendor"}</strong>
                  <em>{row.latestInvoiceSku ?? row.latestInvoiceNumber ?? "no SKU"} · {shortDate(row.latestInvoiceDate)}</em>
                </span>
                <span className={cn("price-monitor-row__trend", (row.change30dPct ?? 0) > 0 && "is-up")}>
                  {pct(row.change30dPct)}
                </span>
                <StatusStamp status={row.status} label={row.statusLabel} />
                <ChevronRight className="inv-row__chev h-4 w-4" />
              </button>
            ))
          )}
        </section>

        <section className="inv-panel price-monitor-detail">
          {selected ? <IngredientDetail row={selected} /> : <NoSelection />}
        </section>
      </div>
    </div>
  )
}

function Kpi({
  folio,
  label,
  value,
  sub,
  alert,
}: {
  folio: string
  label: string
  value: string
  sub: string
  alert?: boolean
}) {
  return (
    <div className={cn("inv-kpi", alert && "inv-kpi--alert")}>
      <div className="inv-kpi__folio">{folio}</div>
      <div className="inv-kpi__label">{label}</div>
      <div className="inv-kpi__value">{value}</div>
      <div className="inv-kpi__sub">{sub}</div>
    </div>
  )
}

function StatusStamp({ status, label }: { status: IngredientPriceIssueStatus; label: string }) {
  const Icon = status === "ok" ? Check : status === "locked" ? Lock : AlertTriangle
  return (
    <span className="price-monitor-status" data-status={status}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function IngredientDetail({ row }: { row: IngredientPriceMonitorRow }) {
  return (
    <>
      <div className="inv-panel__head">
        <div>
          <div className="inv-panel__dept">Selected</div>
          <h2 className="inv-panel__title">{prettifyIngredientName(row.name)}</h2>
        </div>
        <StatusStamp status={row.status} label={row.statusLabel} />
      </div>

      <div className="price-monitor-detail__summary">
        <Metric label="Current" value={`${money(row.currentNormalizedCost)}/${row.currentUnit ?? row.recipeUnit ?? "unit"}`} />
        <Metric label="Latest invoice" value={`${money(row.latestInvoiceNormalizedCost)}/${row.recipeUnit ?? "unit"}`} />
        <Metric label="Raw receipt" value={`${money(row.latestInvoiceRawUnitPrice)}/${row.latestInvoiceRawUnit ?? "unit"}`} mono />
      </div>

      <div className="price-monitor-issue">
        <span>{row.issueDetail}</span>
        {row.change30dPct != null ? (
          <em>
            <TrendingUp className="h-3 w-3" />
            {pct(row.change30dPct)} in 30d
          </em>
        ) : null}
      </div>

      <PriceChart row={row} />
      <Receipts row={row} />
      <MenuImpact row={row} />
    </>
  )
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={mono ? "font-mono" : undefined}>{value}</strong>
    </div>
  )
}

function PriceChart({ row }: { row: IngredientPriceMonitorRow }) {
  const points = row.history.filter(
    (p): p is IngredientPriceMonitorPoint & { normalizedUnitPrice: number } =>
      p.normalizedUnitPrice != null
  )
  if (points.length === 0) {
    return (
      <div className="price-monitor-chart">
        <div className="price-monitor-chart__empty">No normalized invoice points.</div>
      </div>
    )
  }

  const W = 620
  const H = 180
  const padL = 46
  const padR = 14
  const padT = 12
  const padB = 24
  const times = points.map((p) => new Date(p.date).getTime())
  const prices = points.map((p) => p.normalizedUnitPrice)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const pMin = Math.min(...prices)
  const pMax = Math.max(...prices)
  const yPad = Math.max((pMax - pMin) * 0.12, pMax * 0.03, 0.01)
  const yLo = Math.max(0, pMin - yPad)
  const yHi = pMax + yPad
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const x = (t: number) => (tMax === tMin ? padL + innerW / 2 : padL + ((t - tMin) / (tMax - tMin)) * innerW)
  const y = (p: number) => (yHi === yLo ? padT + innerH / 2 : padT + (1 - (p - yLo) / (yHi - yLo)) * innerH)
  const yTicks = [yLo, (yLo + yHi) / 2, yHi]
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(new Date(p.date).getTime()).toFixed(1)} ${y(p.normalizedUnitPrice).toFixed(1)}`)
    .join(" ")

  return (
    <div className="price-monitor-chart">
      <div className="price-monitor-chart__caption">
        <span>normalized invoice cost</span>
        <em>/{row.recipeUnit ?? row.currentUnit ?? "unit"}</em>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g className="price-chart__grid">
          {yTicks.map((v, i) => (
            <line key={i} x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
          ))}
        </g>
        <g className="price-chart__axis">
          {yTicks.map((v, i) => (
            <text key={i} x={padL - 7} y={y(v) + 3} textAnchor="end">
              {money(v, v >= 10 ? 0 : 2)}
            </text>
          ))}
        </g>
        <path d={d} className="price-chart__line" />
        {points.map((p) => (
          <circle
            key={`${p.invoiceId}-${p.date}-${p.rawUnitPrice}`}
            cx={x(new Date(p.date).getTime())}
            cy={y(p.normalizedUnitPrice)}
            r={3}
            className="price-chart__dot"
          >
            <title>{`${p.vendor} · ${p.date} · ${money(p.normalizedUnitPrice)}/${p.normalizedUnit ?? "unit"} · raw ${money(p.rawUnitPrice)}/${p.rawUnit ?? "unit"}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

function Receipts({ row }: { row: IngredientPriceMonitorRow }) {
  if (row.receipts.length === 0) return null
  return (
    <div className="price-monitor-subsection">
      <div className="price-monitor-subsection__label">Recent receipts</div>
      {row.receipts.slice(0, 6).map((receipt) => (
        <div key={`${receipt.invoiceId}-${receipt.date}-${receipt.rawUnitPrice}`} className="price-monitor-receipt">
          <span>{shortDate(receipt.date)}</span>
          <strong>{receipt.vendor}</strong>
          <em>{receipt.sku ?? receipt.invoiceNumber}</em>
          <b>{money(receipt.normalizedUnitPrice)}/{receipt.normalizedUnit ?? row.recipeUnit ?? "unit"}</b>
        </div>
      ))}
    </div>
  )
}

function MenuImpact({ row }: { row: IngredientPriceMonitorRow }) {
  return (
    <div className="price-monitor-subsection">
      <div className="price-monitor-subsection__label">Menu impact</div>
      {row.menuImpact.length === 0 ? (
        <div className="price-monitor-muted">No recipes use this ingredient yet.</div>
      ) : (
        row.menuImpact.map((impact) => (
          <div key={impact.recipeId} className="price-monitor-impact">
            <span>
              <strong>{impact.recipeName}</strong>
              <em>{impact.quantity} {impact.unit}</em>
            </span>
            <b>{impact.missingCost ? "review" : money(impact.lineCost)}</b>
          </div>
        ))
      )}
    </div>
  )
}

function EmptyState({ hasRows }: { hasRows: boolean }) {
  return (
    <div className="price-monitor-empty">
      <h3>{hasRows ? "No rows match these filters" : "No matched invoice history yet"}</h3>
      <p>
        {hasRows
          ? "Widen the status, category, or search terms to bring ingredients back into the ledger."
          : "Sync invoices and review unmatched ingredient lines before this monitor can prove price flow."}
      </p>
    </div>
  )
}

function NoSelection() {
  return (
    <div className="price-monitor-empty">
      <h3>Select an ingredient</h3>
      <p>The detail panel will show normalized invoice history, receipts, and recipe line impact.</p>
    </div>
  )
}
