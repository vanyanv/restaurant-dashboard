import type { DecisionDay } from "@/app/actions/decisions/get-decisions-view"
import type { LaborLane } from "../lib/labor-lane"
import type { HourlyCoverage } from "../lib/hourly-coverage"
import type { Attribution } from "../lib/attribution"

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
    const range = hourRange(startHour, endHour)
    // The day-total and the hourly shape can disagree, and when they do the
    // disagreement is the finding: enough hours on the schedule, posted at the
    // wrong end of the day. Saying only "level" would bury that.
    parts.push(
      day.labor.status === "short"
        ? `Demand outruns the posted schedule ${range}.`
        : `The day carries enough hours, but not where the demand is — short ${range}.`,
    )
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
    <div className="decisions-drawer">
      <div className="decisions-drawer__col">
        <h3 className="decisions-drawer__title">
          <em>{fullDate(day.date)}</em>
        </h3>
        <p className="decisions-drawer__prose">
          {parts.length === 0
            ? "Forecast available — no special signals for this day."
            : parts.join(" ")}
        </p>
        <HourlyChart hourly={day.hourly} />
      </div>

      <div className="decisions-drawer__col">
        {day.attribution ? (
          <Waterfall attribution={day.attribution} predicted={day.predictedRevenue} />
        ) : null}
        <dl className="decisions-drawer__rows">
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
            tone={day.labor.status === "short" ? "accent" : "neutral"}
          />
          <DetailRow
            label="UNFILLED"
            value={
              day.labor.unfilledSlots === 0
                ? "none"
                : `${day.labor.unfilledSlots} shift${day.labor.unfilledSlots === 1 ? "" : "s"}`
            }
            tone={day.labor.unfilledSlots > 0 ? "accent" : "neutral"}
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

/** "Saturday, 23 August" — the drawer is a dateline, not a verdict. */
function fullDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const WEEKDAY = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ]
  const MONTH = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]
  return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`
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
    <div className="decisions-drawer__row">
      <dt className="decisions-drawer__row-label">{label}</dt>
      <dd
        className={`decisions-drawer__row-value is-${tone}`}
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
        <span><i className="is-staff" />staff scheduled</span>
        {/* Deliberately not a number: the GAP row above already carries the
            day's shortfall, and the stretch's own sum differs from it. Two
            similar figures side by side read as a contradiction. */}
        {hourly.worstStretch ? (
          <span><i className="is-short" />uncovered demand</span>
        ) : null}
      </p>
    </div>
  )
}


const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })

/**
 * Why the forecast is what it is.
 *
 * XGBoost computes these contributions exactly, as a by-product of predicting —
 * they are not a post-hoc guess at the model's reasoning. The base is what a day
 * with no distinguishing features would earn; each bar is a group that moved it,
 * and they sum to the forecast.
 *
 * Bars are drawn from a centre line so a drag reads as a drag. Ink for lifts,
 * accent for drags — the one place red is not about urgency but about direction,
 * which the amount beside it makes unambiguous.
 */
function Waterfall({
  attribution,
  predicted,
}: {
  attribution: Attribution
  predicted: number
}) {
  const { base, groups } = attribution
  if (groups.length === 0) return null

  // Scale to the largest single move so the smallest still reads.
  const widest = groups.reduce((m, g) => Math.max(m, Math.abs(g.value)), 0)
  if (widest <= 0) return null

  return (
    <div className="decisions-attr">
      <p className="decisions-attr__title">Why {usd(predicted)} — model attribution</p>
      <div className="decisions-attr__row is-base">
        <span className="decisions-attr__label">Typical day</span>
        {/* Full width, at half strength: the floor every other row moves from,
            drawn as ground rather than as a contribution of its own. */}
        <span className="decisions-attr__track" aria-hidden="true">
          <span className="decisions-attr__bar is-base" />
        </span>
        <span className="decisions-attr__val">{usd(base)}</span>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="decisions-attr__row">
          <span className="decisions-attr__label">{g.label}</span>
          <span className="decisions-attr__track">
            <span
              className={"decisions-attr__bar " + (g.value >= 0 ? "is-up" : "is-down")}
              style={{ width: `${(Math.abs(g.value) / widest) * 50}%` }}
            />
          </span>
          <span className={"decisions-attr__val" + (g.value < 0 ? " is-down" : "")}>
            {g.value >= 0 ? "+" : "−"}{usd(Math.abs(g.value))}
          </span>
        </div>
      ))}
      <div className="decisions-attr__row is-total">
        <span className="decisions-attr__label">Forecast</span>
        <span className="decisions-attr__track" aria-hidden="true" />
        <span className="decisions-attr__val">{usd(predicted)}</span>
      </div>
    </div>
  )
}
