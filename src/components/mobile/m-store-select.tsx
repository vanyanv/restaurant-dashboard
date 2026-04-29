"use client"

import { useRouter } from "next/navigation"

export type ToolbarStore = { id: string; name: string }

type Props = {
  stores: ToolbarStore[]
  storeId: string | null
  pathname: string
  searchParams: Record<string, string | undefined>
}

export function MobileStoreSelect({
  stores,
  storeId,
  pathname,
  searchParams,
}: Props) {
  const router = useRouter()

  function onChange(next: string) {
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "store") merged[k] = v
    }
    if (next) merged.store = next
    const qs = new URLSearchParams(merged).toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={storeId ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Store"
      style={{
        flex: 1,
        appearance: "none",
        background: "transparent",
        border: "1px solid var(--hairline-bold)",
        borderRadius: 0,
        padding: "6px 10px",
        fontFamily:
          "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
        color: "var(--ink)",
        fontWeight: 500,
      }}
    >
      <option value="">All stores</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
