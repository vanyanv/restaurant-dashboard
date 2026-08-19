import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import type { LaborLane } from "../lib/labor-lane"
import type { HourlyCoverage } from "../lib/hourly-coverage"

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
  if (day.hourly.worstStretch) {
    const { startHour, endHour } = day.hourly.worstStretch
    parts.push(`Demand outruns the posted schedule ${hourRange(startHour, endHour)}.`)
  } else if (day.labor.status === "short" && day.labor.gapHours != null) {
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
        <HourlyChart hourly={day.hourly} />
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


/** "6–9pm" reads like a shift; "18:00 to 21:00" reads like a log line. */
function hourLabel(h: number): string {
  const suffix = h < 12 || h === 24 ? "am" : "pm"
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}${suffix}`
}

function hourRange(startHour: number, endHour: number): string {
  const a = hourLabel(startHour)
  const b = hourLabel(endHour)
  // Drop the meridiem on the first half when both sides share it: "6–9pm".
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`
}

/**
 * Where to draw the staffing tick, as a percentage of the plot height.
 *
 * The bars are orders, so the posted hours have to be converted to the orders
 * they can serve before the two can share an axis. `neededHours` is
 * `predictedOrders / throughput`, so throughput falls out as
 * `predictedOrders / neededHours` without the component needing the rate.
 */
function staffTickPct(
  h: { predictedOrders: number; staffedHours: number; neededHours: number | null },
  peak: number,
): number | null {
  if (h.neededHours == null || h.neededHours <= 0 || h.staffedHours <= 0 || peak <= 0) {
    return null
  }
  const throughput = h.predictedOrders / h.neededHours
  const canServe = h.staffedHours * throughput
  return Math.min(100, (canServe / peak) * 100)
}

/**
 * Forecast orders per hour, with the posted staffing drawn over it.
 *
 * Bars are demand; the tick is the labor posted for that hour, on the same
 * scale via the store's throughput. Hours where demand outruns coverage turn
 * red — that stretch is the thing to act on.
 */
function HourlyChart({ hourly }: { hourly: HourlyCoverage }) {
  if (hourly.hours.length === 0 || hourly.peakOrders <= 0) return null
  const peak = hourly.peakOrders

  return (
    <div className="decisions-hours">
      <p className="decisions-hours__title">
        Orders by hour, against the schedule
      </p>
      <div className="decisions-hours__plot" role="img"
        aria-label={
          hourly.worstStretch
            ? `Forecast orders by hour. Short of coverage ${hourRange(hourly.worstStretch.startHour, hourly.worstStretch.endHour)}.`
            : "Forecast orders by hour, fully covered by the posted schedule."
        }
      >
        {hourly.hours.map((h) => (
          <span key={h.hour} className="decisions-hours__col">
            <span
              className={"decisions-hours__bar" + (h.isShort ? " is-short" : "")}
              style={{ height: `${Math.max(2, (h.predictedOrders / peak) * 100)}%` }}
            />
            {staffTickPct(h, peak) != null ? (
              <span
                className="decisions-hours__staff"
                style={{ bottom: `${staffTickPct(h, peak)}%` }}
              />
            ) : null}
          </span>
        ))}
      </div>
      <div className="decisions-hours__axis">
        {hourly.hours.map((h) => (
          <span key={h.hour}>{h.hour % 3 === 0 ? hourLabel(h.hour) : ""}</span>
        ))}
      </div>
      <p className="decisions-hours__legend">
        <span><i className="is-demand" />forecast orders</span>
        <span><i className="is-staff" />staff posted</span>
        {/* Deliberately not a number: the GAP row above already carries the
            day's shortfall, and the stretch's own sum differs from it. Two
            similar figures side by side read as a contradiction. */}
        {hourly.worstStretch ? (
          <span><i className="is-short" />uncovered</span>
        ) : null}
      </p>
    </div>
  )
}
