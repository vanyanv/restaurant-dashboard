import type { BriefingLine } from "@/app/dashboard/forecasts/lib/build-briefing"

interface Props {
  lines: BriefingLine[]
  storeName: string
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

export function DecisionBriefing({ lines, storeName }: Props) {
  if (lines.length === 0) {
    return (
      <section className="inv-panel decisions-briefing">
        <header className="inv-panel__head inv-panel__head--no-rule">
          <span className="inv-panel__dept">This week at {storeName}</span>
          <span className="decisions-briefing__meta">quiet week</span>
        </header>
        <p className="decisions-briefing__empty">
          Nothing unusual flagged. Numbers track plan.
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel decisions-briefing">
      <header className="inv-panel__head">
        <span className="inv-panel__dept">This week at {storeName}</span>
        <span className="decisions-briefing__meta">
          {lines.length} thing{lines.length === 1 ? "" : "s"} to know
        </span>
      </header>
      <ul className="decisions-briefing__list">
        {lines.map((line, i) => (
          <li
            key={`${line.kind}-${i}`}
            className={
              "decisions-briefing__line" +
              (line.severity === 2 ? " is-urgent" : line.severity === 1 ? " is-watch" : "")
            }
          >
            <span className="decisions-briefing__glyph" aria-hidden="true">
              ↳
            </span>
            <span className="decisions-briefing__body">
              {line.chunks.map((chunk, ci) =>
                chunk.kind === "num" ? (
                  <span
                    key={ci}
                    className="decisions-briefing__num"
                    style={TABULAR}
                  >
                    {chunk.value}
                  </span>
                ) : (
                  <span key={ci}>{chunk.value}</span>
                ),
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
