"use client"

import { useCallback, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { returnForm, selectFiledReturn, type FiledReturn } from "@/lib/chat/return"
import type { AskContext } from "./ask-context"
import {
  askStateFor,
  proseFrom,
  toolNamesFrom,
  type AskState,
} from "./ask-state"
import type { ReturnPart } from "@/lib/chat/return"

/**
 * The one thing in the Ask surface that talks to the model.
 *
 * ISOLATED HERE ON PURPOSE. This module is the only place `@ai-sdk/react` and
 * `ai` enter the client bundle, and exactly one component imports it:
 * `components/counter/ask/ask-mount.tsx`, which `AppShell` loads through
 * `next/dynamic`. That chain is what keeps the SDK out of the initial
 * JavaScript of all 42 Counter routes — see `ask-state.ts` for what went wrong
 * when the pure half lived here too.
 *
 * Anything that only needs to READ an `AskState` imports `./ask-state`.
 */
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
