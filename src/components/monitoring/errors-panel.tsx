import { InlineSpark } from "./inline-spark"
import { monoLabel, fraunces17 } from "./styles"

type ErrorRow = {
  id: string
  occurredAt: Date
  source: string
  route: string | null
  status: number | null
  message: string
  stack: string | null
}

export function ErrorsPanel({
  errors,
  byHour,
}: {
  errors: ErrorRow[]
  byHour: { bucket: Date; count: number }[]
}) {
  return (
    <section className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">ERRORS</span>
        <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
          {errors.length} / 24h
        </span>
        <InlineSpark
          points={byHour.map((b) => ({ x: b.bucket, y: b.count }))}
          width={96}
        />
      </div>
      {errors.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no errors in the last 24 hours
        </p>
      ) : (
        <div>
          {errors.map((e) => (
            <div
              key={e.id}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "100px 80px 1fr 2fr",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...monoLabel, color: "var(--accent)" }}>
                {formatTime(e.occurredAt)}
              </span>
              <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                {e.source}
              </span>
              <span style={{ ...fraunces17 }}>{e.route ?? "—"}</span>
              <span
                style={{
                  fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                  fontSize: 13,
                  color: "var(--ink-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatTime(d: Date | string): string {
  const x = new Date(d)
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`
}
