"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { CanonicalIngredientSummary } from "@/types/recipe"

type Props = {
  canonicals: CanonicalIngredientSummary[]
}

export function CatalogTable({ canonicals }: Props) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return canonicals
    return canonicals.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.category ?? "").toLowerCase().includes(q)
    )
  }, [canonicals, query])

  if (canonicals.length === 0) {
    return (
      <div className="border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
        <div className="editorial-section-label">§ empty</div>
        <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
          No canonical ingredients yet.
        </h2>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          Run <em className="not-italic text-[var(--ink)]">Seed from invoices</em> on the recipes page,
          <br />
          or map unmatched line items in the Review tab.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 border-b border-[var(--hairline-bold)] pb-3">
        <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
        <Input
          placeholder="Search ingredients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-sm border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          {filtered.length} of {canonicals.length}
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--hairline-bold)]">
            <Th>Ingredient</Th>
            <Th>Category</Th>
            <Th className="text-right">Aliases</Th>
            <Th className="text-right">Latest price</Th>
            <Th className="text-right">As of</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr
              key={c.id}
              className="border-b border-[var(--hairline)] transition hover:bg-[var(--paper-deep)]"
            >
              <td className="py-3 pr-4">
                <div className="font-display text-[15px] italic text-[var(--ink)]">
                  {c.name}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                  default {c.defaultUnit}
                </div>
              </td>
              <td className="py-3 pr-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                {c.category ?? "—"}
              </td>
              <td className="py-3 pr-4 text-right font-mono text-[12px] tabular-nums text-[var(--ink)]">
                {c.aliasCount}
              </td>
              <td className="py-3 pr-4 text-right font-mono text-[13px] tabular-nums text-[var(--ink)]">
                {c.latestUnitCost != null
                  ? `$${c.latestUnitCost.toFixed(2)}/${c.latestUnit}`
                  : <span className="text-[var(--ink-faint)]">—</span>}
              </td>
              <td className="py-3 text-right font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                {c.latestPriceAt
                  ? new Date(c.latestPriceAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "2-digit",
                    })
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`py-2 pr-4 font-mono text-[9px] font-normal uppercase tracking-[0.18em] text-[var(--ink-faint)] ${className}`}
    >
      {children}
    </th>
  )
}
