"use client"

import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"

export type MobileCatalogRow = {
  id: string
  title: string
  meta: string
  value: string
  subValue?: string | null
  searchText: string
  valueTone?: "default" | "accent" | "muted"
}

type Props = {
  rows: MobileCatalogRow[]
  placeholder: string
  ariaLabel: string
  emptyLabel?: string
  actions?: ReactNode
}

export function MobileCatalogList({
  rows,
  placeholder,
  ariaLabel,
  emptyLabel = "No matches.",
  actions,
}: Props) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) => row.searchText.includes(term))
  }, [rows, deferredQuery])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    overscan: 10,
  })

  return (
    <div className="m-catalog-list">
      <div className="m-catalog-list__toolbar">
        <div className="search-shell m-catalog-list__search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
          />
        </div>
        {actions}
      </div>

      {filtered.length === 0 ? (
        <div className="m-empty m-empty--flush m-catalog-list__empty">
          <strong>{emptyLabel}</strong>
        </div>
      ) : (
        <div ref={scrollRef} data-perf-scroll className="m-catalog-list__viewport">
          <div
            className="m-catalog-list__spacer"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = filtered[virtualRow.index]
              return (
                <div
                  key={row.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="m-catalog-list__item"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="inv-row m-catalog-row">
                    <span className="m-catalog-row__main">
                      <span className="inv-row__vendor-name m-catalog-row__title">
                        {row.title}
                      </span>
                      <span className="m-catalog-row__meta">{row.meta}</span>
                    </span>
                    <span className="m-catalog-row__value">
                      <span
                        className={cn(
                          "inv-row__total",
                          row.valueTone === "muted" && "m-catalog-row__value--muted",
                          row.valueTone === "accent" && "m-catalog-row__value--accent",
                        )}
                      >
                        {row.value}
                      </span>
                      {row.subValue ? (
                        <span className="m-catalog-row__subvalue">{row.subValue}</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
