"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  commitDecision,
  dismissDecision,
} from "@/app/actions/decisions/decision-log-actions"
import type { DecisionAction } from "@/app/actions/decisions/get-decisions-view"
import type { DecisionDeadline } from "../lib/deadline"
import { ConfidenceDots } from "./confidence-dots"

interface Props {
  action: DecisionAction
  /** 1-based position in the ranked ledger. */
  rank: number
  /** asOfDate of the opportunity set on screen, recorded with the decision. */
  asOf: string
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

function fmtDoBy(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
  const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
  return `${WEEKDAY[d.getUTCDay()]} ${MONTH[d.getUTCMonth()]} ${d.getUTCDate().toString().padStart(2, "0")}`
}

/**
 * Every card used to read "DO BY <today+7>". The deadline now reflects what
 * kind of decision it is: a reprice bleeds daily and gets no date to hide
 * behind, a month-long play gets a horizon rather than false urgency.
 */
function deadlineLabel(deadline: DecisionDeadline): string {
  if (deadline.kind === "decays") return "DECAYS DAILY"
  if (deadline.kind === "horizon") return `${deadline.days}-DAY PLAY`
  return `BY ${fmtDoBy(deadline.date)} · ${deadline.daysLeft}D`
}

/** Red is earned: only when the window is genuinely closing. */
function isTight(deadline: DecisionDeadline): boolean {
  return (
    deadline.kind === "decays" ||
    (deadline.kind === "date" && deadline.daysLeft <= 3)
  )
}

/**
 * One line of the ranked ledger.
 *
 * This was a card in an auto-fill grid, which gave five recommendations equal
 * weight and no reading order — the same failure the page had at the top level.
 * As rows they rank, and the ranking is the one the ledger already computed on
 * the 25th percentile, so a wide speculative impact cannot outrank a tight one.
 */
export function ActionRow({ action, rank, asOf }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [whyOpen, setWhyOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ref = {
    storeId: action.storeId,
    opportunityType: action.type,
    opportunityTitle: action.rawTitle,
    opportunityAsOf: asOf,
    predictedImpactUsdPerWeek: action.impactUsdPerWeek,
    predictedImpactP10: action.impactRangeUsdPerWeek?.low ?? null,
    predictedImpactP90: action.impactRangeUsdPerWeek?.high ?? null,
  }

  // The card used to resolve into local state, which forgot on refresh. It now
  // writes a DecisionLog row and lets the server re-render the ledger, so the
  // record outlives the tab — and can be scored later.
  const decide = (fn: typeof commitDecision) => {
    setError(null)
    startTransition(async () => {
      const result = await fn(ref)
      if (result.ok) router.refresh()
      else setError("Couldn't save that. Try again in a moment.")
    })
  }

  return (
    <article className="decisions-ledrow" aria-label={action.title}>
      <span className="decisions-ledrow__rank" style={TABULAR}>
        {rank.toString().padStart(2, "0")}
      </span>

      <div className="decisions-ledrow__body">
        <span className="decisions-ledrow__cat">{action.category}</span>
        <h3 className="decisions-ledrow__title">
          <em>{action.title}</em>
        </h3>
        {action.why ? <p className="decisions-ledrow__why">{action.why}</p> : null}

        {error ? <p className="decisions-ledrow__error">{error}</p> : null}

        {whyOpen ? (
          <div className="decisions-ledrow__evidence">
            <p className="decisions-ledrow__evidence-title">
              Why we&apos;re recommending this
            </p>
            {action.evidence.length === 0 ? (
              <p className="decisions-ledrow__evidence-empty">
                Based on recent sales patterns.
              </p>
            ) : (
              <ul className="decisions-ledrow__evidence-list">
                {action.evidence.map((e, i) => (
                  <li key={i} className="decisions-ledrow__evidence-row">
                    <span className="decisions-ledrow__evidence-kind">{e.kind}</span>
                    <span className="decisions-ledrow__evidence-val" style={TABULAR}>
                      {e.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="decisions-ledrow__amt" style={TABULAR}>
        <span className="decisions-ledrow__figure">
          +{fmtUsd(action.impactUsdPerWeek)}
          <span className="decisions-ledrow__amt-unit">/wk</span>
        </span>
        {action.impactRangeUsdPerWeek ? (
          <span className="decisions-ledrow__band">
            80% CI {fmtUsd(action.impactRangeUsdPerWeek.low)}–
            {fmtUsd(action.impactRangeUsdPerWeek.high)}
          </span>
        ) : null}
        <ConfidenceDots count={action.dots} />
      </div>

      <div className="decisions-ledrow__act">
        <button
          type="button"
          className="decisions-action-btn is-primary"
          onClick={() => decide(commitDecision)}
          disabled={pending}
        >
          {pending ? "Saving…" : "Commit"}
        </button>
        <button
          type="button"
          className="decisions-action-btn"
          onClick={() => decide(dismissDecision)}
          disabled={pending}
        >
          Skip
        </button>
        <button
          type="button"
          className="decisions-action-btn is-ghost"
          onClick={() => setWhyOpen((v) => !v)}
          aria-expanded={whyOpen}
        >
          {whyOpen ? "Hide why" : "Why?"}
        </button>
        <span
          className={
            "decisions-ledrow__deadline" +
            (isTight(action.deadline) ? " is-tight" : "")
          }
          style={TABULAR}
        >
          {deadlineLabel(action.deadline)}
        </span>
      </div>
    </article>
  )
}
