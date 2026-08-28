"use client"

import { useCallback, useMemo, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { returnForm, selectFiledReturn, type FiledReturn } from "@/lib/chat/return"
import type { AskContext } from "./ask-context"
import {
  askStateFor,
  askSteps,
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

    // The in-flight turn, found BEFORE the streaming check rather than after.
    // It is the same message either way — the SDK appends parts to it as they
    // arrive — and reading it while streaming is the entire point: those parts
    // are the reading log the answer's loading state draws.
    let last: (typeof messages)[number] | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") {
        last = messages[i]
        break
      }
    }
    const parts = (last?.parts ?? []) as unknown as ReturnPart[]

    /*
     * WHY THIS CARRIES STEPS NOW.
     *
     * It used to return `{ status: "asking", question }` and nothing else, so
     * `AskAnswerBody` had one static line — "Reading the numbers…" — to show
     * for the whole turn. Measured end to end in a browser, that line sat
     * unchanged for 32.8 of 33.8 seconds: the surface knew the model had
     * called `getDailySales`, got its answer, and moved on to file the return,
     * and said none of it.
     *
     * The prototype had already designed the alternative and the CSS was
     * already ported — `.thinking` and `.tstep` in counter-components.css,
     * under the comment "the loading state of an answer is the reading" —
     * with no component emitting either. See `Thinking`.
     */
    if (status === "submitted" || status === "streaming") {
      return { status: "asking", question, steps: askSteps(parts) }
    }

    // `ready` with no assistant turn yet is the tick between `ask()` setting
    // the question and the SDK moving to `submitted`.
    if (!last) return { status: "asking", question, steps: [] }

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
