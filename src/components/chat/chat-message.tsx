"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { ChatThinking } from "./chat-thinking"
import { ChatArtifacts } from "./chat-artifacts"
import { ChatReturn } from "./chat-return"
import { selectFiledReturn, splitProvenance } from "@/lib/chat/return"

interface MessagePart {
  type: string
  text?: string
  toolName?: string
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
}

interface Props {
  role: "user" | "assistant" | "system" | string
  parts: MessagePart[]
  isStreaming?: boolean
  /** Stagger index for the reveal animation (capped by the parent). */
  msgIdx?: number
  /** 1-based ordinal of this assistant turn, stamped on the return's head. */
  turnNo?: number
  /** Re-run this turn. Absent while streaming or on a user message. */
  onRetry?: () => void
  /** Branch the thread here. Absent unless the turn came from the server —
   * a live turn's id matches no Message row. */
  onBranch?: () => void
  /** ISO timestamp, when the server supplied one. */
  createdAt?: string
}

/** Renders one message in the editorial register.
 *
 * A user turn sets as a docket line: a mono key on the left, the question in
 * Fraunces italic beside it. An assistant turn renders as the Answer Block
 * when the model filed one — verdict, figure strip, evidence, note — and falls
 * back to the older prose-plus-cards layout when it did not. See
 * `docs/superpowers/specs/2026-08-19-chat-answer-block-design.md`. */
function ChatMessageImpl({
  role,
  parts,
  isStreaming,
  msgIdx = 0,
  turnNo,
  onRetry,
  onBranch,
  createdAt,
}: Props) {
  const text = useMemo(
    () =>
      parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join(""),
    [parts],
  )

  const { body, footer } = splitProvenance(text)

  const isAssistant = role === "assistant"

  // Only read a filed return once the stream has settled. Mid-stream the tool
  // part may be half-formed, and swapping layouts under the caret reads as a
  // flicker.
  const filed = useMemo(
    () => (isAssistant && !isStreaming ? selectFiledReturn(parts) : null),
    [isAssistant, isStreaming, parts],
  )

  if (!isAssistant && role === "user") {
    return (
      <div className="chat-message chat-message--user" style={{ ["--msg-idx" as string]: msgIdx }}>
        <div className="chat-docket">
          <span className="chat-docket__key">
            Asked{createdAt ? ` ${formatClock(createdAt)}` : ""}
          </span>
          <span className="chat-docket__q">{body}</span>
        </div>
      </div>
    )
  }

  const noteBody = body ? renderWithTabularNumbers(body) : null

  const actions =
    isAssistant && !isStreaming ? (
      <ChatMessageActions text={text} onRetry={onRetry} onBranch={onBranch} />
    ) : null

  return (
    <div className="chat-message" style={{ ["--msg-idx" as string]: msgIdx }}>
      {!isAssistant && <span className="chat-message__role">{role}</span>}

      {isAssistant && <ChatThinking parts={parts} isStreaming={!!isStreaming} />}

      {filed ? (
        <ChatReturn
          filed={filed}
          turnNo={turnNo}
          evidence={<ChatArtifacts parts={parts} />}
          note={noteBody}
          provenance={footer}
          actions={actions}
        />
      ) : (
        <>
          <div
            className={
              "chat-message__body" +
              (isAssistant ? " chat-message__body--assistant" : "")
            }
          >
            {isStreaming ? body : noteBody}
            {isStreaming && <span className="chat-message__streaming-caret" aria-hidden />}
          </div>

          {isAssistant && !isStreaming && <ChatArtifacts parts={parts} />}

          {footer && <div className="chat-message__footer">{footer}</div>}
          {actions}
        </>
      )}
    </div>
  )
}

// Memoised so that streaming status ticks on the parent don't re-render
// every prior message. `parts` is a stable reference per AI SDK turn.
export const ChatMessage = memo(ChatMessageImpl)

/**
 * Per-message actions. Copy and Retry are always available on a settled
 * assistant turn; Branch only when the turn came from the server. Hidden
 * until the message is hovered or focused so a long thread stays quiet, but
 * they follow the message in the DOM so keyboard order reaches them.
 */
function ChatMessageActions({
  text,
  onRetry,
  onBranch,
}: {
  text: string
  onRetry?: () => void
  onBranch?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked (insecure context, denied permission) — say nothing
         rather than claiming a copy that did not happen */
    }
  }

  return (
    <div className="chat-acts">
      <button
        type="button"
        className={"chat-act" + (copied ? " is-done" : "")}
        onClick={copy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {onRetry && (
        <button type="button" className="chat-act" onClick={onRetry}>
          Retry
        </button>
      )}
      {onBranch && (
        <button type="button" className="chat-act" onClick={onBranch}>
          Branch
        </button>
      )}
    </div>
  )
}

/** Local clock for the docket key, e.g. "14:31". Returns an empty string on
 * an unparseable value so the line degrades to a bare "Asked". */
function formatClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
}

/** Wraps obvious number tokens (currency, percent, comma-grouped digits)
 * in a span that sets tabular figures — keeps assistant prose readable
 * while honoring the dashboard's tabular-numbers rule. */
function renderWithTabularNumbers(text: string): React.ReactNode {
  if (!text) return null
  const re =
    /(\$[\d,]+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <span key={`n-${i++}`} className="tabular">
        {match[0]}
      </span>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
