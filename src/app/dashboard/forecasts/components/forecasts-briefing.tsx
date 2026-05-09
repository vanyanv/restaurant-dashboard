import type { BriefingLine } from "../lib/build-briefing"

interface Props {
  lines: BriefingLine[]
  storeName: string
}

const tabular = { fontVariantNumeric: "tabular-nums lining-nums" } as const

function severityClass(severity: BriefingLine["severity"]) {
  if (severity === 2) return "forecasts-briefing__line is-urgent"
  if (severity === 1) return "forecasts-briefing__line is-watch"
  return "forecasts-briefing__line"
}

export function ForecastsBriefing({ lines, storeName }: Props) {
  if (lines.length === 0) {
    return (
      <section className="inv-panel forecasts-briefing">
        <header className="inv-panel__head inv-panel__head--no-rule">
          <span className="inv-panel__dept">The Briefing · {storeName}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            quiet day
          </span>
        </header>
        <p className="forecasts-briefing__empty">
          Nothing flagged today, numbers track plan.
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel forecasts-briefing">
      <header className="inv-panel__head">
        <span className="inv-panel__dept">The Briefing · {storeName}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {lines.length} item{lines.length === 1 ? "" : "s"} flagged
        </span>
      </header>
      <ul className="forecasts-briefing__list">
        {lines.map((line, i) => (
          <li key={`${line.kind}-${i}`} className={severityClass(line.severity)}>
            <span className="forecasts-briefing__glyph" aria-hidden="true">
              ↳
            </span>
            <span className="forecasts-briefing__body">
              {line.chunks.map((chunk, ci) =>
                chunk.kind === "num" ? (
                  <span
                    key={ci}
                    className="forecasts-briefing__num"
                    style={tabular}
                  >
                    {chunk.value}
                  </span>
                ) : (
                  <span key={ci}>{chunk.value}</span>
                )
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
