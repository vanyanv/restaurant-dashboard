import { InlineSpark } from "./inline-spark"
import { monoLabel, number, fraunces17 } from "./styles"

type ByDay = { day: Date; cost: number; tokens: number }
type ByFeature = {
  feature: string
  provider: string
  model: string
  calls: number
  tokensIn: number
  tokensOut: number
  cost: number
}

export function AiSpendPanel({
  byDay,
  byFeature,
}: {
  byDay: ByDay[]
  byFeature: ByFeature[]
}) {
  const today = byDay[byDay.length - 1]?.cost ?? 0
  const baseline =
    byDay.length > 1
      ? byDay.slice(0, -1).reduce((a, b) => a + b.cost, 0) /
        Math.max(1, byDay.length - 1)
      : 0
  const elevated = baseline > 0 && today > baseline * 1.5
  const pctAbove =
    baseline > 0 ? Math.round(((today - baseline) / baseline) * 100) : 0

  return (
    <section className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">AI SPEND</span>
        <span style={{ ...number, color: "var(--ink)" }}>${today.toFixed(2)}</span>
        <InlineSpark
          points={byDay.map((d) => ({ x: d.day, y: d.cost }))}
          width={96}
        />
        {elevated && (
          <span style={{ ...monoLabel, color: "var(--accent)" }}>
            · +{pctAbove}%
          </span>
        )}
      </div>

      {byFeature.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no AI calls in the last 24 hours
        </p>
      ) : (
        <div>
          {byFeature.map((f) => (
            <div
              key={f.feature}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 70px 140px 90px",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...fraunces17 }}>{f.feature}</span>
              <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                {f.provider} · {f.model}
              </span>
              <span style={{ ...number }}>{f.calls}</span>
              <span style={{ ...number, color: "var(--ink-muted)" }}>
                {fmtTokens(f.tokensIn)} / {fmtTokens(f.tokensOut)}
              </span>
              <span style={{ ...number }}>${f.cost.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {byDay.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="perforation" />
          <div
            style={{ ...monoLabel, color: "var(--ink-faint)", margin: "14px 0 6px" }}
          >
            last 7 days
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 8,
            }}
          >
            {byDay.slice(-7).map((d) => (
              <div key={String(d.day)}>
                <div style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                  {new Date(d.day).toLocaleDateString("en-US", {
                    weekday: "short",
                  })}
                </div>
                <div style={{ ...number, fontSize: 13 }}>
                  ${d.cost.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}
