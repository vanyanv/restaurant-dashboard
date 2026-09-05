"use client"

import { useEffect, useRef, useState } from "react"
import { ASK_DOWN_REASONS, askFeedbackLabel, type AskFeedback } from "@/lib/counter/ask-feedback"
import type { AskTurnMeta } from "@/lib/counter/ask-meta"

/**
 * `.turnfoot` — what the turn cost and what you can do with it.
 *
 * The prototype drew this under its one answer (`P.ask.desk()`, "Read 4
 * sources · $0.041 · 6.2s · Fork from here · Copy") and its own comment says
 * why it sits on the turn and not in a page footer: *"a turn is the unit you
 * fork, keep or throw away."* The Sept-5 mock adds the thumbs.
 *
 * ## The figures are real or absent (D2)
 *
 * Cost and seconds come from `AskTurnMeta` — the route's own `AiUsageEvent`
 * numbers, stamped on the message at `finish` for a live turn and joined
 * from `ChatTurn` for a restored one. A turn with no usage row prints no
 * cost; the seconds fall back to what the page itself measured while the
 * answer streamed, which IS a measurement, not an estimate.
 *
 * ## A thumb writes `ChatTurn.feedback` (D3)
 *
 * 👍 writes `up`. 👎 asks one question with four answers (`ASK_DOWN_REASONS`)
 * and writes `down:<reason>` — the popover scales from the thumb it belongs
 * to (bottom-right origin, 150ms), and once a reason is picked it becomes a
 * "Noted · wrong scope" line rather than vanishing. Pressing the lit thumb
 * again clears the rating. The rating is optimistic: the button lights on
 * press and unlights if the action refuses.
 *
 * ## Fork is only offered where it can be kept
 *
 * `forkConversation` branches through a `Message.id`, and only a restored
 * turn carries one (see `AskAnswer.messageId`). A live turn shows no Fork
 * here; the rail's "Fork from the end" reaches it after the refresh.
 */
export interface TurnFootProps {
  read: string[]
  meta: AskTurnMeta | null
  /** Seconds the page measured itself, for a live turn before `meta` lands. */
  liveDurationMs?: number | null
  onRate: (feedback: AskFeedback | null) => Promise<string | null>
  onFork?: () => void
  /** What "Copy" puts on the clipboard: the verdict, the figures, the prose. */
  copyText: string
}

export function TurnFoot({ read, meta, liveDurationMs = null, onRate, onFork, copyText }: TurnFootProps) {
  const [rating, setRating] = useState<string | null>(meta?.feedback ?? null)
  const [asking, setAsking] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pop = useRef<HTMLSpanElement>(null)

  // The stored rating arrives with the thread; a later render of the same
  // turn must not wipe a thumb the reader just pressed.
  useEffect(() => {
    if (meta?.feedback) setRating(meta.feedback)
  }, [meta?.feedback])

  useEffect(() => {
    if (!asking) return
    const off = (e: MouseEvent) => {
      if (pop.current?.contains(e.target as Node)) return
      setAsking(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAsking(false)
    }
    document.addEventListener("click", off)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("click", off)
      document.removeEventListener("keydown", esc)
    }
  }, [asking])

  const rate = (next: AskFeedback | null) => {
    const prev = rating
    setRating(next)
    setAsking(false)
    setSaid(null)
    void onRate(next).then((err) => {
      if (err) {
        setRating(prev)
        setSaid(err)
      }
    })
  }

  const ms = meta?.durationMs ?? liveDurationMs
  const secs = ms !== null && ms !== undefined && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : null
  const cost = meta?.costUsd !== null && meta?.costUsd !== undefined ? `$${meta.costUsd.toFixed(3)}` : null
  const noted = said ?? askFeedbackLabel(rating)
  const down = rating !== null && rating !== "up"

  return (
    <div className="turnfoot">
      <span>
        Read {read.length} source{read.length === 1 ? "" : "s"}
      </span>
      {cost ? <span>{cost}</span> : null}
      {secs ? <span>{secs}</span> : null}
      <span className="sp" />
      <span className={`thanks${noted ? " on" : ""}`} aria-live="polite">
        {noted}
      </span>
      <span className="thumbs" ref={pop}>
        <button
          type="button"
          className={rating === "up" ? "on" : undefined}
          aria-pressed={rating === "up"}
          aria-label="Good answer"
          onClick={() => rate(rating === "up" ? null : "up")}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 14H3.5a1 1 0 01-1-1V8a1 1 0 011-1H5M5 7l2.6-4.6a1.3 1.3 0 012.4.7V6h2.7a1.4 1.4 0 011.4 1.6l-.9 5.2A1.4 1.4 0 0111.8 14H5z" />
          </svg>
        </button>
        <button
          type="button"
          className={down ? "on dn" : undefined}
          aria-pressed={down}
          aria-haspopup="menu"
          aria-expanded={asking}
          aria-label="Wrong or unhelpful"
          onClick={() => (down ? rate(null) : setAsking((v) => !v))}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 2h1.5a1 1 0 011 1v5a1 1 0 01-1 1H11M11 9l-2.6 4.6a1.3 1.3 0 01-2.4-.7V10H3.3a1.4 1.4 0 01-1.4-1.6l.9-5.2A1.4 1.4 0 014.2 2H11z" />
          </svg>
        </button>
        <div className={`pop${asking ? " on" : ""}`} role="menu">
          <div className="k">What was wrong?</div>
          {ASK_DOWN_REASONS.map((r) => (
            <button type="button" role="menuitem" key={r.code} onClick={() => rate(r.code)}>
              {r.label}
              <span>{r.hint}</span>
            </button>
          ))}
        </div>
      </span>
      {onFork ? (
        <button type="button" onClick={onFork}>
          Fork from here
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(copyText).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}
