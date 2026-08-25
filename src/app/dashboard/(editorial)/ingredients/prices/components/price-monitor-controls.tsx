"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

type Props = {
  days: number
  storeId: string | null
  stores: Array<{ id: string; name: string }>
}

const RANGE_OPTIONS = [14, 30, 60, 90, 180]

export function PriceMonitorControls({ days, storeId, stores }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (!value || value === "all") {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <>
      <div className="price-monitor-segment" aria-label="Date range">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="toolbar-btn"
            data-active={days === option}
            onClick={() => setParam("days", String(option))}
          >
            {option}d
          </button>
        ))}
      </div>
      {stores.length > 1 ? (
        <select
          aria-label="Store"
          value={storeId ?? "all"}
          onChange={(e) => setParam("storeId", e.target.value)}
          className="price-monitor-select"
        >
          <option value="all">All stores</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      ) : null}
    </>
  )
}
