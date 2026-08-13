import { fraunces17, monoLabel, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { TopRoute } from "@/lib/monitoring/engagement"

export function TopRoutesPanel({ routes }: { routes: TopRoute[] }) {
  const max = Math.max(1, ...routes.map((r) => r.visits))

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Most visited
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          visits · median dwell
        </span>
      </div>

      {routes.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No page views recorded yet.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {routes.map((r) => (
            <li
              key={r.route}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 60px 70px",
                alignItems: "baseline",
                gap: 12,
                padding: "8px 4px",
              }}
            >
              <span style={{ position: "relative", ...monoLabel, color: "var(--ink)" }}>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: "-3px auto -3px 0",
                    width: `${(r.visits / max) * 100}%`,
                    background: "rgba(220, 38, 38, 0.07)",
                    zIndex: 0,
                  }}
                />
                <span style={{ position: "relative" }}>{r.route}</span>
              </span>
              <span style={{ ...number, fontSize: 13, textAlign: "right" }}>
                {r.visits}
              </span>
              <span
                style={{ ...monoLabel, color: "var(--ink-muted)", textAlign: "right" }}
              >
                {r.medianDwellMs == null
                  ? "—"
                  : `${Math.round(r.medianDwellMs / 1000)}s`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
