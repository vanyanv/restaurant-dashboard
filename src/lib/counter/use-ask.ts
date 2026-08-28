"use client"

import { useCallback, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
  returnForm,
  selectFiledReturn,
  splitProvenance,
  type FiledReturn,
  type ReturnForm,
  type ReturnPart,
} from "@/lib/chat/return"
import type { AskContext } from "./ask-context"

/**
 * ONE question's lifecycle, for the ⌘K palette.
 *
 * `POST /api/chat` has existed for months with 116 tools behind it and a
 * structured answer format (`fileReturn` → `selectFiledReturn`), and the
 * palette that every Counter page mounts could not reach it: `AppShell`
 * passed `AskSurface` no `onSubmit`. This is the wire.
 *
 * ---------------------------------------------------------------------------
 * WHY `useChat` AND NOT A HAND-ROLLED `fetch`
 * ---------------------------------------------------------------------------
 *
 * The route answers in the AI SDK's UI-message stream, and `selectFiledReturn`
 * reads `parts[]` — `type`, `state`, `output` — off a settled assistant
 * message. `useChat` is the thing that turns that stream back into `parts[]`.
 * Re-implementing the decoder here would be a second parser for one wire
 * format, and the one figure/one function rule applies to a stream as much as
 * to a number.
 *
 * ---------------------------------------------------------------------------
 * ONE QUESTION, NOT A CONVERSATION (K-R4)
 * ---------------------------------------------------------------------------
 *
 * `ask()` clears the message list before it sends, so the palette never sends
 * a second turn and never pays for history it will not show. The palette
 * answers one question; the page holds the conversation. No `conversationId`
 * is sent either — the route creates one per question, which is what makes
 * "Open in Ask" have something to open once that route exists.
 *
 * ---------------------------------------------------------------------------
 * SCOPE TRAVELS IN THE QUESTION (K-R1)
 * ---------------------------------------------------------------------------
 *
 * `AskContext.sentence` — "Answering about Overview · Chris N Eddys -
 * Hollywood · Aug 20 – Aug 26" — is prepended to the user message. It is
 * already the line the palette shows the reader BEFORE they type, so what
 * gets sent is exactly what was promised on screen, and the system prompt
 * resolves the named store through its own `listStores` tool. The route takes
 * no scope field and does not grow one for this.
 */

export interface AskAnswer {
  question: string
  filed: FiledReturn | null
  /** Prose the model wrote outside the filed block, provenance split off. */
  body: string
  /** Tool names called, in order, deduped — the "Read" row. */
  read: string[]
  form: ReturnForm
}

export type AskState =
  | { status: "idle" }
  | { status: "asking"; question: string }
  | { status: "answered"; answer: AskAnswer }
  | { status: "failed"; question: string; message: string }

/** Filing the return is not reading anything, so it never appears in "Read". */
const FILE_RETURN_TOOL = "fileReturn"

/**
 * What the turn actually read, in the order it read it.
 *
 * A tool whose output never landed read nothing — a call that errored or was
 * still streaming its input would put a source on the row that produced no
 * figure, which is the precise dishonesty K-R2 exists to prevent.
 */
function toolNamesFrom(parts: readonly ReturnPart[]): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (!p || typeof p.type !== "string") continue
    const name = p.toolName ?? (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null)
    if (!name || name === FILE_RETURN_TOOL) continue
    if (p.state !== "output-available") continue
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** The model's own paragraphs, in order, with the provenance footer split off
 *  — the "Read" row is the provenance now, and printing it twice reads as two
 *  different claims about the same sources. */
function proseFrom(parts: readonly ReturnPart[]): string {
  const text = parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => (p.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
  return splitProvenance(text).body.trim()
}

/* --------------------------------------------------------------------------
 * SELECTORS
 *
 * Branching on a `status` field is `surface/`'s and `lib/counter`'s job, not a
 * component's — `npm run tokens`' `no-status-branch` rule says so, and it is
 * right here for the ordinary reason as well: a pane that reads three payloads
 * off three narrowed shapes is a pane that has to be re-checked every time the
 * union grows. These three are the whole surface a renderer needs.
 * ----------------------------------------------------------------------- */

/** The question as the reader typed it — unscoped, unprefixed. "" when idle. */
export function askQuestion(state: AskState): string {
  if (state.status === "idle") return ""
  if (state.status === "answered") return state.answer.question
  return state.question
}

/** The settled answer, or null while asking / failed / idle. */
export function askAnswer(state: AskState): AskAnswer | null {
  return state.status === "answered" ? state.answer : null
}

/** Why it could not answer at all — a transport or auth failure, NOT a
 *  no-data refusal, which is a real answer and arrives as one (K-R3). */
export function askFailure(state: AskState): string | null {
  return state.status === "failed" ? state.message : null
}

export function useAsk(): {
  state: AskState
  ask: (question: string, context: AskContext) => void
  reset: () => void
} {
  // The question as TYPED. The message on the wire carries the scope sentence
  // in front of it; the surface must never show the reader that plumbing back.
  const [question, setQuestion] = useState<string | null>(null)

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), [])
  const { messages, sendMessage, setMessages, status, error } = useChat({ transport })

  const ask = useCallback(
    (raw: string, context: AskContext) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      // Synchronous on the SDK's own store, so the send below starts from an
      // empty list rather than appending to the previous question's turn.
      setMessages([])
      setQuestion(trimmed)
      void sendMessage({ text: `${context.sentence}.\n${trimmed}` })
    },
    [sendMessage, setMessages],
  )

  const reset = useCallback(() => {
    setQuestion(null)
    setMessages([])
  }, [setMessages])

  const state = useMemo<AskState>(() => {
    if (question === null) return { status: "idle" }

    if (status === "error") {
      const message = error?.message?.trim()
      return {
        status: "failed",
        question,
        message: message && message.length > 0 ? message : "The answer never arrived.",
      }
    }

    if (status === "submitted" || status === "streaming") return { status: "asking", question }

    let last: (typeof messages)[number] | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        last = messages[i]
        break
      }
    }
    // `ready` with no assistant turn yet is the tick between `ask()` setting
    // the question and the SDK moving to `submitted`.
    if (!last) return { status: "asking", question }

    const parts = (last.parts ?? []) as unknown as ReturnPart[]
    const filed = selectFiledReturn(parts)

    return {
      status: "answered",
      answer: {
        question,
        filed,
        body: proseFrom(parts),
        read: toolNamesFrom(parts),
        // Nothing filed means nothing to lay out — the empty form is prose and
        // its sources, which is exactly what there is.
        form: filed ? returnForm(filed) : "empty",
      },
    }
  }, [question, status, error, messages])

  return { state, ask, reset }
}
