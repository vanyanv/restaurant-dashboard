"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"

type Summary = {
  refreshedAt: string
  db: { totalBytes: number; capBytes: number; pct: number }
  redis: {
    keys: number
    memoryPct: number | null
    commandsPct: number | null
    available: { keys: boolean; memory: boolean; commands: boolean }
  }
  syncs: { jobName: string; status: string | null; overdue: boolean }[]
  errorsCount: number
  todayCostUsd: number
}

export function Masthead({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const selected = params.get("store") || "all"

  const { data, dataUpdatedAt, refetch, isFetching } = useQuery<Summary>({
    queryKey: ["monitoring-summary", selected],
    queryFn: async () => {
      const url = `/api/monitoring/summary${selected !== "all" ? `?store=${selected}` : ""}`
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error("summary fetch failed")
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const overdueCount = data?.syncs.filter((s) => s.overdue && s.status !== "FAILURE").length ?? 0
  const failingCount = data?.syncs.filter((s) => s.status === "FAILURE").length ?? 0
  const dbPct = Math.round(data?.db.pct ?? 0)
  const errCount = data?.errorsCount ?? 0
  const cost = data?.todayCostUsd ?? 0
  const cachePct = data?.redis.memoryPct ?? null

  const allGood =
    !!data &&
    failingCount === 0 &&
    overdueCount === 0 &&
    errCount === 0 &&
    dbPct < 75 &&
    (cachePct === null || cachePct < 80)

  const onStoreChange = (v: string) => {
    const sp = new URLSearchParams(params.toString())
    if (v === "all") sp.delete("store"); else sp.set("store", v)
    router.replace(`?${sp.toString()}`)
  }

  return (
    <header className="mb-10 mt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1
          style={{
            fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 500,
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
            letterSpacing: "-0.03em",
            lineHeight: 0.95,
            color: "var(--ink)",
          }}
        >
          Monitoring
        </h1>
        <StoreFilter stores={stores} selected={selected} onChange={onStoreChange} />
      </div>

      <div
        className="mt-3 font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)" }}
      >
        {formatFolio(dataUpdatedAt)} · last refresh {ago(dataUpdatedAt)} ·{" "}
        <button
          type="button"
          onClick={() => refetch()}
          aria-label="Refresh"
          style={{
            display: "inline-block",
            transition: "transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1)",
            transform: isFetching ? "rotate(360deg)" : "rotate(0deg)",
          }}
        >
          ↻
        </button>
      </div>

      <p
        className="mt-4"
        style={{
          fontFamily: "DM Sans, ui-sans-serif, sans-serif",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-muted)",
          maxWidth: "70ch",
        }}
      >
        {data === undefined ? (
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            loading
          </span>
        ) : allGood ? (
          <>
            All {data.syncs.length} syncs current. No errors in the last 24 hours. AI spend ${cost.toFixed(2)} today, on baseline. Database {dbPct}%
            {cachePct !== null ? <>. Cache memory {Math.round(cachePct)}%.</> : <>.</>}
          </>
        ) : (
          <Degraded data={data} dbPct={dbPct} errCount={errCount} cachePct={cachePct} />
        )}
      </p>
    </header>
  )
}

function Degraded({
  data,
  dbPct,
  errCount,
  cachePct,
}: {
  data: Summary
  dbPct: number
  errCount: number
  cachePct: number | null
}) {
  const parts: React.ReactNode[] = []
  for (const f of data.syncs.filter((s) => s.status === "FAILURE")) {
    parts.push(<span key={`fail-${f.jobName}`} style={{ color: "var(--accent)" }}>{f.jobName} failing</span>)
  }
  for (const o of data.syncs.filter((s) => s.overdue && s.status !== "FAILURE")) {
    parts.push(<span key={`over-${o.jobName}`} style={{ color: "var(--accent)" }}>{o.jobName} overdue</span>)
  }
  if (errCount > 0) parts.push(<span key="err" style={{ color: "var(--accent)" }}>{errCount} errors logged today</span>)
  if (dbPct >= 75) parts.push(<span key="db" style={{ color: "var(--accent)" }}>DB at {dbPct}%</span>)
  if (cachePct !== null && cachePct >= 80) parts.push(<span key="cache" style={{ color: "var(--accent)" }}>cache memory at {Math.round(cachePct)}%</span>)
  if (parts.length === 0) {
    return <>Loading status…</>
  }
  return <>{parts.flatMap((p, i) => i === 0 ? [p] : [", ", p])}.</>
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

function formatFolio(t: number): string {
  if (!t) return ""
  const d = new Date(t)
  const day = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
  const date = d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  return `${day} · ${date} · ${time}`
}

function ago(t: number): string {
  if (!t) return "—"
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
