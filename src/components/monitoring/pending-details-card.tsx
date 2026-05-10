import type { PendingDetailsRow } from "@/lib/monitoring/queries"
import { monoLabel, number, fraunces17 } from "./styles"

const HIGH_THRESHOLD = 500

/**
 * Per-store backlog of OtterOrder rows whose detailsFetchedAt is null.
 * Surfaces the data-correctness signal for COGS accuracy that previously
 * had zero monitoring surface.
 */
export function PendingDetailsCard({ rows }: { rows: PendingDetailsRow[] }) {
  const hasAlert = rows.some((r) => r.pending > HIGH_THRESHOLD || r.growing)
  const total = rows.reduce((sum, r) => sum + r.pending, 0)

  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">PENDING ORDER DETAILS</span>
        <span
          style={{
            ...monoLabel,
            color: hasAlert ? "var(--accent)" : "var(--ink-muted)",
          }}
        >
          {total.toLocaleString()} TOTAL
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no active stores
        </p>
      ) : (
        <div>
          {rows.map((r) => {
            const isHigh = r.pending > HIGH_THRESHOLD
            const isProblem = isHigh || r.growing
            return (
              <div
                key={r.storeId}
                className="inv-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 120px",
                  gap: 16,
                  alignItems: "baseline",
                  background: isProblem ? "var(--row-hover-bg)" : undefined,
                }}
              >
                <span style={{ ...fraunces17, color: "var(--ink)" }}>{r.storeName}</span>
                <span
                  style={{
                    ...number,
                    color: isProblem ? "var(--accent)" : "var(--ink)",
                    textAlign: "right",
                  }}
                >
                  {r.pending.toLocaleString()}
                </span>
                <span
                  style={{
                    ...monoLabel,
                    color: r.growing ? "var(--accent)" : "var(--ink-faint)",
                  }}
                >
                  {r.growing ? "GROWING" : isHigh ? "HIGH" : "OK"}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
