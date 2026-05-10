import type { StaleStoreRow } from "@/lib/monitoring/queries"
import { monoLabel, fraunces17 } from "./styles"

/**
 * Stale-store alert card. Reads OtterStore.lastSyncAt per active store and
 * flags red when older than 90 minutes (default — workflow runs every 2h, so
 * 90min past a tick is a real miss, not "between runs").
 *
 * This is the new-stores-launch alarm: "did Glendale sync today?"
 */
export function StaleStoresCard({ rows }: { rows: StaleStoreRow[] }) {
  const staleCount = rows.filter((r) => r.isStale).length

  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">STORE FRESHNESS</span>
        <span
          style={{
            ...monoLabel,
            color: staleCount > 0 ? "var(--accent)" : "var(--ink-muted)",
          }}
        >
          {staleCount > 0 ? `${staleCount} STALE` : "ALL FRESH"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no active stores
        </p>
      ) : (
        <div>
          {rows.map((r) => (
            <div
              key={r.storeId}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 100px",
                gap: 16,
                alignItems: "baseline",
                background: r.isStale ? "var(--row-hover-bg)" : undefined,
              }}
            >
              <span style={{ ...fraunces17, color: "var(--ink)" }}>{r.storeName}</span>
              <span
                style={{
                  ...monoLabel,
                  color: r.isStale ? "var(--accent)" : "var(--ink-muted)",
                }}
              >
                {r.lastSyncAt ? formatAgo(r.lastSyncAt) : "NEVER"}
              </span>
              <span
                style={{
                  ...monoLabel,
                  color: r.isStale ? "var(--accent)" : "var(--ink-faint)",
                }}
              >
                {r.isStale ? "STALE" : "FRESH"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatAgo(d: Date | string): string {
  const t = new Date(d).getTime()
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}S AGO`
  if (s < 3600) return `${Math.round(s / 60)}M AGO`
  if (s < 86400) return `${Math.round(s / 3600)}H AGO`
  return `${Math.round(s / 86400)}D AGO`
}
