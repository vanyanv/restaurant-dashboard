import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"

interface Props {
  day: DecisionDay
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

function pctText(p: number | null): string | null {
  if (p == null) return null
  const sign = p >= 0 ? "+" : ""
  return `${sign}${(p * 100).toFixed(0)}%`
}

export function DayDetailPanel({ day }: Props) {
  const headline =
    day.bucket === "busy"
      ? `${day.weekdayShort.charAt(0)}${day.weekdayShort.slice(1).toLowerCase()} looks busy`
      : day.bucket === "slow"
        ? `${day.weekdayShort.charAt(0)}${day.weekdayShort.slice(1).toLowerCase()} looks slow`
        : `${day.weekdayShort.charAt(0)}${day.weekdayShort.slice(1).toLowerCase()} looks normal`

  const pct = pctText(day.pctVsTrailing)
  const parts: string[] = []
  if (pct && day.pctVsTrailing != null) {
    if (day.bucket === "busy") {
      parts.push(`Predicted about ${pct} above the trailing week.`)
    } else if (day.bucket === "slow") {
      parts.push(`Predicted about ${pct} below the trailing week.`)
    } else {
      parts.push("Predicted in line with the trailing week.")
    }
  }
  if (day.weatherPhrase) parts.push(`Weather: ${day.weatherPhrase}.`)
  if (day.eventPhrase) parts.push(`Heads up: ${day.eventPhrase}.`)
  if (day.anomalyHint) parts.push(`Watch: ${day.anomalyHint} flagged yesterday.`)

  return (
    <div className="inv-panel decisions-day-detail">
      <header className="inv-panel__head">
        <span className="inv-panel__dept">
          {day.weekdayShort} · {day.monthDayShort}
        </span>
        <span className="decisions-day-detail__bucket">
          {day.bucket.toUpperCase()}
        </span>
      </header>
      <div className="decisions-day-detail__body">
        <div className="decisions-day-detail__prose">
          <h3 className="decisions-day-detail__headline">
            <em>{headline}</em>
          </h3>
          <p className="decisions-day-detail__paragraph">
            {parts.length === 0
              ? "Forecast available — no special signals for this day."
              : parts.join(" ")}
          </p>
        </div>
        <dl className="decisions-day-detail__rows">
          <DetailRow
            label="STAFF"
            value={
              day.staffDelta == null
                ? "—"
                : day.staffDelta > 0
                  ? `+${day.staffDelta} vs typical`
                  : day.staffDelta < 0
                    ? `${day.staffDelta} vs typical`
                    : "as usual"
            }
            tone={
              day.staffDelta && day.staffDelta > 0
                ? "accent"
                : day.staffDelta && day.staffDelta < 0
                  ? "muted"
                  : "neutral"
            }
          />
          <DetailRow
            label="WEATHER"
            value={day.weatherPhrase ?? "no signal"}
            tone="neutral"
          />
          <DetailRow
            label="EVENT"
            value={day.eventPhrase ?? "none nearby"}
            tone="neutral"
          />
          <DetailRow
            label="FOOD COST"
            value={day.foodCostNote ?? "on track"}
            tone={day.foodCostNote?.includes("over") ? "accent" : "neutral"}
          />
        </dl>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "accent" | "muted" | "neutral"
}) {
  return (
    <div className="decisions-day-detail__row">
      <dt className="decisions-day-detail__row-label">{label}</dt>
      <dd
        className={`decisions-day-detail__row-value is-${tone}`}
        style={TABULAR}
      >
        {value}
      </dd>
    </div>
  )
}
