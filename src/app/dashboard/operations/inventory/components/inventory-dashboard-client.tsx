"use client"

import { useMemo, useState } from "react"
import type {
  InventoryDashboardData,
  InventoryDashboardRow,
} from "@/app/actions/inventory/dashboard-actions"
import type { ReorderStatus } from "@/lib/inventory/reorder-recommendation"
import type { ConfidenceLevel } from "@/lib/inventory/calibration"

interface Props {
  data: InventoryDashboardData
}

const STATUS_LABEL: Record<ReorderStatus, string> = {
  ok: "OK",
  reorder_soon: "REORDER SOON",
  reorder_now: "REORDER NOW",
  urgent: "URGENT",
  no_signal: "NO SIGNAL",
}

const STATUS_CLASS: Record<ReorderStatus, string> = {
  ok: "text-[var(--ink-faint)]",
  reorder_soon: "text-[var(--ink)]",
  reorder_now: "text-[var(--accent)]",
  urgent: "text-[var(--accent)] font-semibold",
  no_signal: "text-[var(--ink-faint)]",
}

const STATUS_RANK: Record<ReorderStatus, number> = {
  urgent: 0,
  reorder_now: 1,
  reorder_soon: 2,
  ok: 3,
  no_signal: 4,
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  LOW: "LOW",
  MEDIUM: "MED",
  HIGH: "HIGH",
  VERIFIED: "VERIFIED",
}

const CONFIDENCE_CLASS: Record<ConfidenceLevel, string> = {
  LOW: "text-[var(--ink-faint)]",
  MEDIUM: "text-[var(--ink-muted)]",
  HIGH: "text-[var(--ink)]",
  VERIFIED: "text-[var(--ink)] font-semibold",
}

type SortKey = "status" | "name" | "cover" | "rate" | "lastCount"

function fmt(n: number, max = 2) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, { maximumFractionDigits: max })
}

function fmtDate(d: Date | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export function InventoryDashboardClient({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("status")
  const [filterStatus, setFilterStatus] = useState<"all" | "flagged">("all")

  const reorderRows = useMemo(
    () =>
      data.rows.filter(
        (r) =>
          r.status === "urgent" ||
          r.status === "reorder_now" ||
          r.status === "reorder_soon"
      ),
    [data.rows]
  )

  const reorderByVendor = useMemo(() => {
    const buckets = new Map<string, InventoryDashboardRow[]>()
    for (const r of reorderRows) {
      const key = r.recentVendorRaw ?? "Unassigned vendor"
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(r)
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [reorderRows])

  const tableRows = useMemo(() => {
    const filtered =
      filterStatus === "flagged"
        ? data.rows.filter(
            (r) =>
              r.status === "urgent" ||
              r.status === "reorder_now" ||
              r.status === "reorder_soon"
          )
        : data.rows
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "status":
          return STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.ingredientName.localeCompare(b.ingredientName)
        case "name":
          return a.ingredientName.localeCompare(b.ingredientName)
        case "cover":
          return (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)
        case "rate":
          return b.ratePerDay - a.ratePerDay
        case "lastCount":
          return (
            (b.baseAt?.getTime() ?? 0) - (a.baseAt?.getTime() ?? 0)
          )
      }
    })
    return sorted
  }, [data.rows, sortKey, filterStatus])

  return (
    <>
      <section className="inv-panel inv-panel--flush">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Reorder this week</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            {reorderRows.length} flagged
          </span>
        </header>
        {reorderByVendor.length === 0 ? (
          <div className="px-5 py-6 text-[var(--ink-muted)]">
            Nothing to reorder right now.
          </div>
        ) : (
          <div>
            {reorderByVendor.map(([vendor, items]) => (
              <div key={vendor} className="border-t border-[var(--hairline)]">
                <div className="px-5 py-3 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink)]">
                    {vendor}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    lead {fmt(items[0].leadDays, 1)} d
                    {items[0].leadSampleSize === 0 ? " · est" : ""}
                  </span>
                </div>
                {items.map((r) => (
                  <div
                    key={r.ingredientId}
                    className="grid grid-cols-[1fr_120px_120px_140px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
                  >
                    <div className="text-[14px] text-[var(--ink)]">
                      {r.ingredientName}
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] ml-2">
                        {r.category}
                      </span>
                    </div>
                    <div
                      className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                      style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                    >
                      {r.daysOfCover != null ? `${fmt(r.daysOfCover, 1)} d cover` : "—"}
                    </div>
                    <div
                      className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                      style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                    >
                      by {fmtDate(r.reorderBy)}
                    </div>
                    <div
                      className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${STATUS_CLASS[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="inv-panel inv-panel--flush">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">All ingredients</span>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <button
              type="button"
              onClick={() => setFilterStatus(filterStatus === "all" ? "flagged" : "all")}
              className="hover:text-[var(--accent)]"
            >
              {filterStatus === "all" ? "all" : "flagged only"}
            </button>
            <span>·</span>
            <SortBtn current={sortKey} value="status" onChange={setSortKey}>status</SortBtn>
            <SortBtn current={sortKey} value="name" onChange={setSortKey}>name</SortBtn>
            <SortBtn current={sortKey} value="cover" onChange={setSortKey}>cover</SortBtn>
            <SortBtn current={sortKey} value="rate" onChange={setSortKey}>rate</SortBtn>
            <SortBtn current={sortKey} value="lastCount" onChange={setSortKey}>last count</SortBtn>
          </div>
        </header>
        <div>
          <div className="grid grid-cols-[1.2fr_100px_100px_120px_100px_110px_140px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Ingredient</span>
            <span className="text-right">On hand</span>
            <span className="text-right">Cover (d)</span>
            <span className="text-right">Rate / day</span>
            <span className="text-right">Last count</span>
            <span className="text-right">Confidence</span>
            <span className="text-right">Status</span>
          </div>
          {tableRows.map((r) => (
            <div
              key={r.ingredientId}
              className="grid grid-cols-[1.2fr_100px_100px_120px_100px_110px_140px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[var(--row-hover-bg)] transition-colors"
            >
              <div>
                <div className="text-[14px] text-[var(--ink)]">{r.ingredientName}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  {r.category} · {r.recipeUnit || "—"}
                </div>
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmt(r.onHand, 1)}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {r.daysOfCover != null ? fmt(r.daysOfCover, 1) : "—"}
              </div>
              <div
                className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {r.ratePerDay > 0 ? fmt(r.ratePerDay, 2) : "—"}
              </div>
              <div className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {fmtDate(r.baseAt)}
              </div>
              <div
                className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${CONFIDENCE_CLASS[r.confidenceLevel]}`}
                title={`${r.confidenceSampleSize} count${r.confidenceSampleSize === 1 ? "" : "s"}${r.isGraduated ? " · graduated" : ""}`}
              >
                {CONFIDENCE_LABEL[r.confidenceLevel]}
                <span className="ml-1 text-[var(--ink-faint)] normal-case">
                  · {r.confidenceSampleSize}
                </span>
              </div>
              <div
                className={`text-right font-mono text-[10px] uppercase tracking-[0.18em] ${STATUS_CLASS[r.status]}`}
              >
                {STATUS_LABEL[r.status]}
              </div>
            </div>
          ))}
          {tableRows.length === 0 && (
            <div className="px-5 py-6 text-[var(--ink-muted)]">No ingredients to show.</div>
          )}
        </div>
      </section>
    </>
  )
}

function SortBtn({
  current,
  value,
  onChange,
  children,
}: {
  current: SortKey
  value: SortKey
  onChange: (v: SortKey) => void
  children: React.ReactNode
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={active ? "text-[var(--ink)]" : "hover:text-[var(--accent)]"}
    >
      {children}
    </button>
  )
}
