"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { monoLabel } from "./styles"

type Summary = {
  refreshedAt: string
}

export function Masthead({
  stores,
  commitSha,
  tzLabel,
}: {
  stores: { id: string; name: string }[]
  commitSha: string
  tzLabel: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const selected = params.get("store") || "all"

  const { dataUpdatedAt, refetch, isFetching } = useQuery<Summary>({
    queryKey: ["monitoring-summary", selected],
    queryFn: async () => {
      const url = `/api/monitoring/summary${selected !== "all" ? `?store=${selected}` : ""}`
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error("summary fetch failed")
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const onStoreChange = (v: string) => {
    const sp = new URLSearchParams(params.toString())
    if (v === "all") sp.delete("store")
    else sp.set("store", v)
    router.replace(`?${sp.toString()}`)
  }

  return (
    <header className="mb-4 mt-6 flex items-baseline justify-between gap-4 flex-wrap">
      <h1
        style={{
          fontFamily: "var(--font-fraunces), serif",
          fontSize: 28,
          fontWeight: 500,
          fontVariationSettings: '"opsz" 96, "SOFT" 30',
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: "var(--ink)",
        }}
      >
        Monitoring
      </h1>
      <div className="flex items-baseline gap-4 flex-wrap">
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            fontVariantNumeric: "tabular-nums lining-nums",
          }}
        >
          {formatFolio(dataUpdatedAt, tzLabel)}
          {dataUpdatedAt ? ` · sha ${commitSha}` : ""} · {ago(dataUpdatedAt)}{" "}
          ·{" "}
          <button
            type="button"
            onClick={() => refetch()}
            aria-label="Refresh"
            className="monitoring-refresh-icon"
            data-spinning={isFetching ? "true" : undefined}
            style={{
              cursor: "pointer",
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              font: "inherit",
              letterSpacing: "inherit",
            }}
          >
            ↻
          </button>
        </span>
        <StoreFilter
          stores={stores}
          selected={selected}
          onChange={onStoreChange}
        />
      </div>
    </header>
  )
}

function StoreFilter({
  stores,
  selected,
  onChange,
}: {
  stores: { id: string; name: string }[]
  selected: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={`toolbar-btn${selected === "all" ? " active" : ""}`}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {stores.map((s) => (
        <button
          type="button"
          key={s.id}
          className={`toolbar-btn${selected === s.id ? " active" : ""}`}
          onClick={() => onChange(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}

function formatFolio(t: number, tz: string): string {
  if (!t) return ""
  const d = new Date(t)
  const day = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase()
  const date = d
    .toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase()
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${day} · ${date} · ${time} ${tz}`
}

function ago(t: number): string {
  if (!t) return "—"
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
