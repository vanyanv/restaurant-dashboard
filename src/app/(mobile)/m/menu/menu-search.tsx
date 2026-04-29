"use client"

import { useMemo, useState } from "react"

type Row = {
  name: string
  category: string
  totalQty: number
  mappedRecipeName: string | null
  storeCount: number
}

export function MenuSearch({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("")
  const [unmappedOnly, setUnmappedOnly] = useState(false)

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let r = rows
    if (unmappedOnly) r = r.filter((x) => !x.mappedRecipeName)
    if (term) {
      r = r.filter(
        (x) =>
          x.name.toLowerCase().includes(term) ||
          x.category.toLowerCase().includes(term)
      )
    }
    return r
  }, [rows, q, unmappedOnly])

  return (
    <>
      <div
        style={{
          margin: "12px 16px",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          className="search-shell"
          style={{ flex: 1, display: "flex", alignItems: "center" }}
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search menu items"
            aria-label="Search menu items"
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
        <button
          type="button"
          onClick={() => setUnmappedOnly((u) => !u)}
          className={`toolbar-btn${unmappedOnly ? " active" : ""}`}
          style={{ fontSize: 11 }}
        >
          Unmapped
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="m-empty m-empty--flush" style={{ margin: "0 16px 12px" }}>
          <strong>No matches.</strong>
        </div>
      ) : (
        filtered.map((r) => (
          <div
            key={r.name}
            className="inv-row"
            style={{
              cursor: "default",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "12px 18px",
            }}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="inv-row__vendor-name" style={{ fontSize: 14 }}>
                {r.name}
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
                {r.category} · {r.storeCount} store
                {r.storeCount === 1 ? "" : "s"} ·{" "}
                {r.mappedRecipeName ?? "UNMAPPED"}
              </span>
            </span>
            <span className="inv-row__total">
              {r.totalQty.toLocaleString()}
            </span>
          </div>
        ))
      )}
    </>
  )
}
