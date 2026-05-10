import { monoLabel, number, fraunces17 } from "./styles"

type Db = { totalBytes: number; capBytes: number; pct: number }
type Tbl = { table: string; bytes: number; rows: number }
type Conn = { active: number; max: number }

export function DatabasePanel({
  db,
  tables,
  conn,
}: {
  db: Db
  tables: Tbl[]
  conn: Conn
}) {
  const pct = db.pct
  const barColor =
    pct >= 90
      ? "var(--accent-dark)"
      : pct >= 75
        ? "var(--accent)"
        : "var(--ink)"

  return (
    <section className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">DATABASE</span>
        <span
          style={{
            ...number,
            color: pct >= 75 ? "var(--accent)" : "var(--ink)",
          }}
        >
          {fmtBytes(db.totalBytes)} / {fmtBytes(db.capBytes)} · {pct.toFixed(0)}%
        </span>
      </div>

      <div
        style={{
          height: 4,
          border: "1px solid var(--hairline-bold)",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, pct)}%`,
            background: barColor,
            transition:
              "width 280ms cubic-bezier(0.2, 0.7, 0.2, 1), background 280ms",
          }}
        />
      </div>

      <div>
        {tables.map((t) => {
          const share = db.totalBytes > 0 ? (t.bytes / db.totalBytes) * 100 : 0
          return (
            <div
              key={t.table}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 200px 100px",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...fraunces17 }}>{t.table}</span>
              <span style={{ ...number }}>{fmtBytes(t.bytes)}</span>
              <div
                style={{ height: 3, border: "1px solid var(--hairline)" }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${share}%`,
                    background: "var(--ink-muted)",
                  }}
                />
              </div>
              <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                {String(t.rows)} rows
              </span>
            </div>
          )
        })}
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--hairline)",
        }}
      >
        <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
          connections{" "}
        </span>
        <span style={{ ...number }}>
          {conn.active} / {conn.max}
        </span>
      </div>
    </section>
  )
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
