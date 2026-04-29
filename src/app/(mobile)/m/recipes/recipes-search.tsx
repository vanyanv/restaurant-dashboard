"use client"

import { useMemo, useState } from "react"

type Row = {
  id: string
  itemName: string
  category: string
  isSellable: boolean
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export function RecipesSearch({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) =>
        r.itemName.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term)
    )
  }, [rows, q])

  return (
    <>
      <div
        className="search-shell"
        style={{
          margin: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search recipes"
          aria-label="Search recipes"
          style={{
            flex: 1,
            background: "transparent",
            border: 0,
            outline: 0,
            padding: 0,
            fontFamily:
              "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
            fontSize: 13,
            color: "var(--ink)",
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="m-empty m-empty--flush" style={{ margin: "0 16px 12px" }}>
          <strong>No matches.</strong>
        </div>
      ) : (
        filtered.map((r) => (
          <div
            key={r.id}
            className="inv-row"
            style={{
              cursor: "default",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "12px 18px",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="inv-row__vendor-name" style={{ fontSize: 15 }}>
                {r.itemName}
              </span>
              <span
                style={{
                  fontFamily:
                    "var(--font-jetbrains-mono), ui-monospace, monospace",
                  fontSize: 9.5,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                }}
              >
                {r.category} · {r.ingredientCount} ingr ·{" "}
                {r.isConfirmed ? "CONFIRMED" : "DRAFT"}
                {r.isSellable ? " · SELLABLE" : ""}
              </span>
            </span>
            <span style={{ textAlign: "right" }}>
              <span className="inv-row__total">
                {r.computedCost != null ? fmtMoney(r.computedCost) : "—"}
              </span>
              {r.partialCost ? (
                <div
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.16em",
                    color: "var(--accent-dark)",
                    marginTop: 3,
                  }}
                >
                  PARTIAL
                </div>
              ) : null}
            </span>
          </div>
        ))
      )}
    </>
  )
}
