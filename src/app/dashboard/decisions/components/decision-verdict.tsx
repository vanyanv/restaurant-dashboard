import { splitVerdictChunks } from "../lib/verdict-copy"
import { accuracySubtitle, type Vitals } from "../lib/vitals"

interface Props {
  line: string
  sources: string[]
  vitals: Vitals
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

const fmtUsd = (n: number, max = 0): string =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })

const fmtHours = (n: number): string => {
  const abs = Math.abs(n)
  return Number.isInteger(abs) ? `${abs}` : abs.toFixed(1)
}

function WeekForecast({ v }: { v: Vitals }) {
  const { total, p10, p90, daysCounted } = v.weekForecast
  return (
    <div className="decisions-vital">
      <span className="decisions-vital__label">Week forecast</span>
      <span className="decisions-vital__value" style={TABULAR}>
        {total == null ? "—" : fmtUsd(total)}
      </span>
      <span className="decisions-vital__sub" style={TABULAR}>
        {total == null
          ? "no forecast yet"
          : p10 != null && p90 != null
            ? `${fmtUsd(p10)}–${fmtUsd(p90)} likely`
            : `over ${daysCounted} day${daysCounted === 1 ? "" : "s"}`}
      </span>
    </div>
  )
}

function LaborGap({ v }: { v: Vitals }) {
  const { hours, status, shortDays, unscheduledDays } = v.laborGap

  // Earn-the-red: a genuinely short week is a state worth the proofmark. Heavy
  // takes the ochre the day lane already uses for the same condition.
  const tone =
    status === "short" ? " is-short" : status === "heavy" ? " is-heavy" : ""

  const sub =
    status === "unknown"
      ? unscheduledDays > 0
        ? `${unscheduledDays} day${unscheduledDays === 1 ? "" : "s"} unpublished`
        : "no schedule to judge"
      : status === "short"
        ? `${shortDays} day${shortDays === 1 ? "" : "s"} short`
        : status === "heavy"
          ? "over what the week earns"
          : "level with the week"

  return (
    <div className="decisions-vital">
      <span className="decisions-vital__label">Labor gap</span>
      <span className={`decisions-vital__value${tone}`} style={TABULAR}>
        {hours == null || status === "unknown"
          ? "—"
          : `${hours < 0 ? "−" : "+"}${fmtHours(hours)}h`}
      </span>
      <span className="decisions-vital__sub">{sub}</span>
    </div>
  )
}

function SalesPerLaborHour({ v }: { v: Vitals }) {
  const { actual, target, status } = v.splh
  return (
    <div className="decisions-vital">
      <span className="decisions-vital__label">Sales per labor hour</span>
      <span className="decisions-vital__value" style={TABULAR}>
        {actual == null ? "—" : fmtUsd(actual)}
      </span>
      <span className="decisions-vital__sub" style={TABULAR}>
        {actual == null || target == null
          ? "nothing scheduled"
          : status === "level"
            ? `on this week's ${fmtUsd(target)} target`
            : `${status} the ${fmtUsd(target)} target`}
      </span>
    </div>
  )
}

function Accuracy({ v }: { v: Vitals }) {
  const a = v.accuracy
  return (
    <div className="decisions-vital">
      <span className="decisions-vital__label">Forecast accuracy</span>
      <span className="decisions-vital__value" style={TABULAR}>
        {a?.wape == null ? "—" : `${(a.wape * 100).toFixed(1)}%`}
      </span>
      <span className="decisions-vital__sub" style={TABULAR}>
        {a == null ? "no reconciled days yet" : accuracySubtitle(a)}
      </span>
    </div>
  )
}

/**
 * Act I — the verdict.
 *
 * The page led with a seven-cell calendar, a bulleted briefing and five action
 * cards at equal visual weight, so nothing told the owner what to read first.
 * Design principle #1: the page leads with one verdict, not three equal panels.
 *
 * The figures inside the sentence are lifted into DM Sans tabular rather than
 * riding along in Fraunces italic — the two-tier rule is explicit that a
 * Fraunces-italic dollar amount fails the system.
 */
export function DecisionVerdict({ line, sources, vitals }: Props) {
  return (
    <section className="decisions-verdict" aria-label="The call this week">
      <p className="decisions-verdict__kicker">The call this week</p>

      <h2 className="decisions-verdict__line">
        {splitVerdictChunks(line).map((chunk, i) =>
          chunk.kind === "num" ? (
            <b key={i} className="decisions-verdict__num" style={TABULAR}>
              {chunk.value}
            </b>
          ) : (
            <span key={i}>{chunk.value}</span>
          ),
        )}
      </h2>

      {sources.length > 0 ? (
        <p className="decisions-verdict__src">From: {sources.join(" · ")}</p>
      ) : null}

      <div className="decisions-vitals">
        <WeekForecast v={vitals} />
        <LaborGap v={vitals} />
        <SalesPerLaborHour v={vitals} />
        <Accuracy v={vitals} />
      </div>
    </section>
  )
}
