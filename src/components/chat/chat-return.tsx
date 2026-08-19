"use client"

import type { ReactNode } from "react"
import { returnForm, type FiledReturn, type ReturnFigure } from "@/lib/chat/return"

interface Props {
  filed: FiledReturn
  /** Ordinal of this assistant turn within the conversation, 1-based. Stamped
   * on the head as a folio so a return can be referred to by number. */
  turnNo?: number
  /** The artifact cards for this turn. They render as the evidence slot in the
   * middle of the block rather than hanging below the prose. */
  evidence?: ReactNode
  /** The model's paragraph, demoted to a note under the evidence. */
  note?: ReactNode
  /** The one-line provenance footer, already split off the note. */
  provenance?: string | null
  /** Copy / Retry / Branch, rendered under the block. */
  actions?: ReactNode
}

/**
 * The Answer Block — see
 * `docs/superpowers/specs/2026-08-19-chat-answer-block-design.md`.
 *
 * Three forms, chosen by `returnForm` from what the model filed:
 *   full  — head, verdict, figure strip, evidence, note, provenance
 *   short — two hairlines and one ledger line, for a single-fact answer
 *   empty — frame and verdict with no figure strip, for an out-of-scope ask
 */
export function ChatReturn({
  filed,
  turnNo,
  evidence,
  note,
  provenance,
  actions,
}: Props) {
  const form = returnForm(filed)

  if (form === "short") {
    const fig = filed.figures[0]
    return (
      <div className="chat-return chat-return--short">
        <div className="chat-return__short">
          {fig ? (
            <>
              <span className="chat-return__short-value">{fig.value}</span>
              {fig.delta && <DeltaStamp delta={fig.delta} direction={fig.direction} />}
              <span className="chat-return__short-label">{fig.label}</span>
            </>
          ) : (
            <span className="chat-return__short-verdict">{filed.verdict}</span>
          )}
          <span className="chat-return__short-spacer" />
          {filed.scope && <span className="chat-return__short-label">{filed.scope}</span>}
        </div>
        {fig && <div className="chat-return__short-verdict">{filed.verdict}</div>}
        {evidence}
        {note && <div className="chat-return__note">{note}</div>}
        {provenance && <div className="chat-return__prov">{provenance}</div>}
        {actions}
      </div>
    )
  }

  return (
    <div className="chat-return">
      <div className="chat-return__head">
        <span className="chat-return__dept">
          {turnNo ? `Return No. ${String(turnNo).padStart(4, "0")} · ` : ""}
          {filed.department}
        </span>
        {filed.scope && <span className="chat-return__scope">{filed.scope}</span>}
      </div>

      <div className="chat-return__verdict">{filed.verdict}</div>

      {form === "full" && filed.figures.length > 0 && (
        <div className="chat-return__figs">
          {filed.figures.map((f, i) => (
            <Figure key={`${f.label}-${i}`} figure={f} />
          ))}
        </div>
      )}

      {evidence}
      {note && <div className="chat-return__note">{note}</div>}
      {provenance && <div className="chat-return__prov">{provenance}</div>}
      {actions && <div className="chat-return__acts">{actions}</div>}
    </div>
  )
}

function Figure({ figure }: { figure: ReturnFigure }) {
  return (
    <div className="chat-return__fig">
      <div className="chat-return__fig-value">{figure.value}</div>
      <div className="chat-return__fig-row">
        {figure.delta && <DeltaStamp delta={figure.delta} direction={figure.direction} />}
        <span className="chat-return__fig-label">{figure.label}</span>
      </div>
    </div>
  )
}

/**
 * The delta as a rotated rubber stamp. `direction` is the model's judgement,
 * not the arithmetic sign — a 14% rise in produce spend arrives as "down" and
 * reads in `--subtract`. The arrow and the sign are both rendered, so the
 * colour is never the only signal (Color-Plus-Label, DESIGN.md §2).
 */
function DeltaStamp({
  delta,
  direction,
}: {
  delta: string
  direction?: "up" | "down"
}) {
  const cls =
    direction === "up"
      ? "chat-stamp chat-stamp--up"
      : direction === "down"
        ? "chat-stamp chat-stamp--down"
        : "chat-stamp"
  const mark = direction === "up" ? "▲" : direction === "down" ? "▼" : ""
  return (
    <span className={cls}>
      {mark && <span aria-hidden>{mark}</span>}
      {delta}
    </span>
  )
}
