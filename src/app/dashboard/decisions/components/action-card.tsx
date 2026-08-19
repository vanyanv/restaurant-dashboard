"use client"

import { useState } from "react"
import type { DecisionAction } from "@/app/actions/decisions/get-decisions-view"
import type { DecisionDeadline } from "../lib/deadline"
import { ConfidenceDots } from "./confidence-dots"

interface Props {
  action: DecisionAction
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

export function ActionCard({ action }: Props) {
  const [state, setState] = useState<"open" | "done" | "skipped">("open")
  const [whyOpen, setWhyOpen] = useState(false)

  if (state !== "open") {
    return (
      <article
        className={`inv-panel decisions-action-card is-${state}`}
        aria-label={`${action.title} — ${state}`}
      >
        <p className="decisions-action-card__resolved">
          {state === "done" ? "Marked done." : "Skipped this week."}{" "}
          <button
            type="button"
            className="decisions-link"
            onClick={() => setState("open")}
          >
            undo
          </button>
        </p>
      </article>
    )
  }

  return (
    <article className="inv-panel decisions-action-card" aria-label={action.title}>
      <header className="decisions-action-card__head">
        <span className="decisions-action-card__category">{action.category}</span>
        <span
          className={
            "decisions-action-card__doby" +
            (isTight(action.deadline) ? " is-tight" : "")
          }
          style={TABULAR}
        >
          {deadlineLabel(action.deadline)}
        </span>
      </header>

      <h3 className="decisions-action-card__title">
        <em>{action.title}</em>
      </h3>

      <div className="decisions-action-card__impact" style={TABULAR}>
        +{fmtUsd(action.impactUsdPerWeek)}
        <span className="decisions-action-card__impact-unit">/wk</span>
      </div>

      {action.why ? (
        <p className="decisions-action-card__why">{action.why}</p>
      ) : null}

      <footer className="decisions-action-card__foot">
        <ConfidenceDots count={action.dots} />
        <div className="decisions-action-card__buttons">
          <button
            type="button"
            className="decisions-action-btn is-primary"
            onClick={() => setState("done")}
          >
            Mark done
          </button>
          <button
            type="button"
            className="decisions-action-btn"
            onClick={() => setState("skipped")}
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
        </div>
      </footer>

      {whyOpen ? (
        <div className="decisions-action-card__evidence">
          <p className="decisions-action-card__evidence-title">
            Why we&apos;re recommending this
          </p>
          {action.evidence.length === 0 ? (
            <p className="decisions-action-card__evidence-empty">
              Based on recent sales patterns.
            </p>
          ) : (
            <ul className="decisions-action-card__evidence-list">
              {action.evidence.map((e, i) => (
                <li key={i} className="decisions-action-card__evidence-row">
                  <span className="decisions-action-card__evidence-kind">
                    {e.kind}
                  </span>
                  <span
                    className="decisions-action-card__evidence-val"
                    style={TABULAR}
                  >
                    {e.value}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  )
}
