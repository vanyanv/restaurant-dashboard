import type { DecisionRecord } from "@/app/actions/decisions/get-decisions-view"
import type { DecisionOutcome } from "../lib/decision-outcome"
import { MIN_DAYS_TO_JUDGE } from "../lib/decision-outcome"

interface Props {
  decisions: DecisionRecord[]
}

const TABULAR = { fontVariantNumeric: "tabular-nums lining-nums" as const }

const usd = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const fmtDate = (d: Date) =>
  `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`

/**
 * What the owner already decided, and what came of it.
 *
 * The measurement compares actuals against the forecast frozen at commit time —
 * an interrupted time series, not a randomised trial. It answers "did the week
 * beat what we expected", which is the honest question; it cannot separate this
 * decision from anything else that changed the same week. The caption says so.
 */
export function DecisionLedger({ decisions }: Props) {
  if (decisions.length === 0) return null

  const committed = decisions.filter((d) => d.state === "COMMITTED")
  const scored = committed.filter((d) => d.outcome && d.outcome.verdict !== "measuring")

  return (
    <section aria-label="Decisions already made">
      <header className="decisions-section-head">
        <h2 className="decisions-section-head__title">
          <em>What you decided</em>
        </h2>
        <span className="decisions-section-head__meta">
          {committed.length} committed · {scored.length} scored
        </span>
      </header>

      <div className="decisions-log">
        {decisions.map((d) => (
          <article key={`${d.storeId}-${d.opportunityType}-${d.rawTitle}`} className="decisions-log__row">
            <span className={`decisions-log__state is-${d.state.toLowerCase()}`}>
              {d.state === "COMMITTED" ? "Committed" : "Skipped"}
            </span>
            <div className="decisions-log__body">
              <h3 className="decisions-log__title">{d.title}</h3>
              <p className="decisions-log__meta" style={TABULAR}>
                {fmtDate(d.decidedAt)}
                {d.storeName ? ` · ${d.storeName}` : ""}
                {" · promised "}
                {usd(d.predictedImpactUsdPerWeek)}/wk
                {d.dismissReason ? ` · "${d.dismissReason}"` : ""}
              </p>
            </div>
            <OutcomeCell outcome={d.outcome} state={d.state} />
          </article>
        ))}
      </div>

      <p className="decisions-log__caveat">
        Measured against the forecast frozen when you committed — what the week
        was expected to do untouched. That is a comparison, not a controlled
        trial: it can&apos;t separate your change from anything else that moved
        the same week.
      </p>
    </section>
  )
}

function OutcomeCell({
  outcome,
  state,
}: {
  outcome: DecisionOutcome | null
  state: DecisionRecord["state"]
}) {
  if (state === "DISMISSED") {
    return <span className="decisions-log__verdict is-quiet">not taken</span>
  }
  // No counterfactual was captured, so this one can never be scored. Distinct
  // from a freeze whose days simply have not closed yet.
  if (!outcome || outcome.frozenDays === 0) {
    return <span className="decisions-log__verdict is-quiet">no baseline saved</span>
  }
  if (outcome.verdict === "measuring") {
    return (
      <span className="decisions-log__verdict is-quiet" style={TABULAR}>
        {outcome.daysObserved} of {MIN_DAYS_TO_JUDGE} days in
      </span>
    )
  }

  const label =
    outcome.verdict === "working"
      ? "Working"
      : outcome.verdict === "backfiring"
        ? "Backfiring"
        : "No clear effect"

  return (
    <span className="decisions-log__outcome">
      <span className={`decisions-log__verdict is-${outcome.verdict}`}>{label}</span>
      <span className="decisions-log__delta" style={TABULAR}>
        {outcome.deltaUsd >= 0 ? "+" : "−"}
        {usd(Math.abs(outcome.deltaUsd))} vs forecast
      </span>
      <span className="decisions-log__evidence" style={TABULAR}>
        {outcome.daysAbove > outcome.daysBelow
          ? `${outcome.daysAbove} of ${outcome.daysObserved} days above the band`
          : outcome.daysBelow > 0
            ? `${outcome.daysBelow} of ${outcome.daysObserved} days below the band`
            : `${outcome.daysObserved} days inside the band`}
      </span>
    </span>
  )
}
