"use client"

import { memo, useMemo } from "react"
import { ChatThinking } from "./chat-thinking"
import { ChatArtifacts } from "./chat-artifacts"

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
}

/** Renders one message in the editorial register: a small mono role label
 * above the body, body text in DM Sans 13px, numbers wrapped in tabular
 * spans, footer line in mono caption. The provenance footer (the model's
 * "From getDailySales · …" line) is detected and pulled into its own
 * caption row. */
function ChatMessageImpl({ role, parts, isStreaming, msgIdx = 0 }: Props) {
  const text = useMemo(
    () =>
      parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join(""),
    [parts],
  )

  const { body, footer } = splitFooter(text)

  const isAssistant = role === "assistant"

  return (
    <div
      className="chat-message"
      style={{ ["--msg-idx" as string]: msgIdx }}
    >
      <span className="chat-message__role">
        {role === "user" ? "You" : isAssistant ? "Assistant" : role}
      </span>

      {isAssistant && (
        <ChatThinking parts={parts} isStreaming={!!isStreaming} />
      )}

      <div
        className={
          "chat-message__body" +
          (isAssistant ? " chat-message__body--assistant" : "")
        }
      >
        {renderWithTabularNumbers(body)}
        {isStreaming && <span className="chat-message__streaming-caret" aria-hidden />}
      </div>

      {isAssistant && !isStreaming && <ChatArtifacts parts={parts} />}

      {footer && <div className="chat-message__footer">{footer}</div>}
    </div>
  )
}

// Memoised so that streaming status ticks on the parent don't re-render
// every prior message. `parts` is a stable reference per AI SDK turn.
export const ChatMessage = memo(ChatMessageImpl)

/** Pulls the provenance footer ("From X · …") off the tail of the body
 * so we can render it in mono caption instead of in DM Sans 13px. */
function splitFooter(text: string): { body: string; footer: string | null } {
  const match = text.match(/\n+\s*(?:>\s*)?From\s+[^\n]+$/i)
  if (!match) return { body: text, footer: null }
  return {
    body: text.slice(0, match.index!).trimEnd(),
    footer: match[0]
      .replace(/^[\s>]+/, "")
      .trim(),
  }
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
