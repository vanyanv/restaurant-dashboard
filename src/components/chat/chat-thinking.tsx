"use client"

import { useMemo } from "react"
import { labelFor } from "./tool-labels"

interface ToolPart {
  type: string
  toolName?: string
  state?: string
}

interface Props {
  /** Every part of the assistant message, including tool-call parts. */
  parts: ToolPart[]
  /** True while the model is still streaming. Drives the "thinking"
   * affordance vs the post-stream summary. */
  isStreaming: boolean
}

/** Replaces the JSON tool-trace expander with a Claude-style "thinking"
 * line. While streaming, shows the verb for the most recent tool that
 * hasn't returned yet (e.g. "Searching invoices…"). Once the stream is
 * complete, collapses to a single dim caption listing what was used. */
export function ChatThinking({ parts, isStreaming }: Props) {
  const calls = useMemo(() => {
    return parts
      .filter((p) => typeof p.type === "string" && p.type.startsWith("tool-"))
      .map((p) => ({
        name: p.toolName ?? p.type.replace(/^tool-/, ""),
        state: p.state ?? "input-streaming",
      }))
  }, [parts])

  if (calls.length === 0) {
    if (!isStreaming) return null
    // Streaming with no tool calls yet — model is composing directly.
    return (
      <div className="chat-thinking chat-thinking--active">
        <span className="chat-thinking__dot" aria-hidden />
        <span className="chat-thinking__verb">Thinking</span>
      </div>
    )
  }

  if (isStreaming) {
    // Find the latest call that hasn't finished. The most recent input
    // part usually represents what the model is still waiting on.
    const pending = [...calls]
      .reverse()
      .find((c) => c.state !== "output-available" && c.state !== "output-error")
    const target = pending ?? calls[calls.length - 1]
    return (
      <div className="chat-thinking chat-thinking--active">
        <span className="chat-thinking__dot" aria-hidden />
        <span className="chat-thinking__verb">{labelFor(target.name).running}</span>
      </div>
    )
  }

  // Post-stream: single quiet line summarizing the tools used. Each label's
  // `short` field is the bare noun ("invoices", "sales") so the leading
  // verb only appears once.
  const distinct = Array.from(new Set(calls.map((c) => c.name)))
  return (
    <div className="chat-thinking chat-thinking--done">
      Read · {distinct.map((n) => labelFor(n).short).join(" · ")}
    </div>
  )
}
