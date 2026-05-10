import type { StoreSyncGrid } from "@/lib/monitoring/queries"
import { monoLabel, number, fraunces17 } from "./styles"

/**
 * Per-store sync status grid. Rows = active stores, columns = job names.
 * Each cell shows last-run age + status; threshold-flagged cells go red.
 *
 * Design spec: editorial docket — hairline frames, no shadows, no shadcn.
 * Threshold red is var(--accent), not bg-red-* / text-red-*.
 */
export function StoreSyncGrid({ grid }: { grid: StoreSyncGrid }) {
  if (grid.stores.length === 0) {
    return (
      <section className="inv-panel">
        <div className="inv-panel__head">
          <span className="inv-panel__dept">SYNCS BY STORE</span>
        </div>
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no active stores
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">SYNCS BY STORE</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFeatureSettings: '"tnum" 1, "lnum" 1',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "12px 8px 8px",
                  borderBottom: "1px solid var(--hairline)",
                  ...monoLabel,
                  color: "var(--ink-faint)",
                  whiteSpace: "nowrap",
                }}
              >
                STORE
              </th>
              {grid.jobNames.map((j) => (
                <th
                  key={j}
                  style={{
                    textAlign: "left",
                    padding: "12px 12px 8px",
                    borderBottom: "1px solid var(--hairline)",
                    ...monoLabel,
                    color: "var(--ink-faint)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {j.replace(/^otter\./, "").replace(/^cogs\./, "cogs.")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.stores.map((s) => (
              <tr key={s.storeId}>
                <td
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid var(--hairline)",
                    ...fraunces17,
                    color: "var(--ink)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.storeName}
                </td>
                {grid.jobNames.map((j) => {
                  const cell = grid.cells[`${s.storeId}|${j}`]
                  const isFail = cell?.status === "FAILURE"
                  const isFlagged = cell?.flagged ?? false
                  const isProblem = isFail || isFlagged
                  const tone: string = isProblem ? "var(--accent)" : "var(--ink-muted)"
                  return (
                    <td
                      key={j}
                      title={cell?.flagReason ?? undefined}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--hairline)",
                        background: isProblem ? "var(--row-hover-bg)" : undefined,
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cell?.lastRunAt ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ ...monoLabel, color: tone }}>
                            {formatAgo(cell.lastRunAt)}
                            {cell.status && cell.status !== "SUCCESS"
                              ? ` · ${cell.status.toLowerCase()}`
                              : ""}
                          </span>
                          <span style={{ ...number, fontSize: 13, color: "var(--ink)" }}>
                            {cell.rowsWritten ?? "—"}
                            {cell.durationMs != null ? (
                              <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>
                                {" · "}
                                {formatDuration(cell.durationMs)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ) : (
                        <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>NEVER</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}MS`
  return `${(ms / 1000).toFixed(1)}S`
}
