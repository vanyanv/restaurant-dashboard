import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import type { LaborLane } from "../lib/labor-lane"

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
  if (day.labor.status === "short" && day.labor.gapHours != null) {
    parts.push(
      `You are ${Math.abs(day.labor.gapHours)} hours short of what this day earns at typical productivity.`,
    )
  } else if (day.labor.status === "heavy" && day.labor.gapHours != null) {
    parts.push(
      `Carrying ${day.labor.gapHours} hours more than this day earns at typical productivity.`,
    )
  }
  if (day.labor.unfilledSlots > 0) {
    parts.push(
      `${day.labor.unfilledSlots} shift${day.labor.unfilledSlots === 1 ? "" : "s"} published with nobody assigned.`,
    )
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
            label="SCHEDULED"
            value={
              day.labor.status === "unscheduled"
                ? "none published"
                : `${day.labor.scheduledHours} hrs`
            }
            tone={day.labor.status === "unscheduled" ? "accent" : "neutral"}
          />
          <DetailRow
            label="NEEDED"
            value={
              day.labor.neededHours == null
                ? "no benchmark"
                : `${day.labor.neededHours} hrs`
            }
            tone="neutral"
          />
          <DetailRow
            label="GAP"
            value={laborGapText(day.labor)}
            tone={
              day.labor.status === "short"
                ? "accent"
                : day.labor.status === "heavy"
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

/** "11 hrs short" reads faster than "-11". */
function laborGapText(labor: LaborLane): string {
  if (labor.gapHours == null) return "—"
  if (labor.status === "level") return "level"
  return labor.gapHours < 0
    ? `${Math.abs(labor.gapHours)} hrs short`
    : `${labor.gapHours} hrs over`
}
