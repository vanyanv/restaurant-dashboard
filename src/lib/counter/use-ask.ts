"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { returnForm, selectFiledReturn } from "@/lib/chat/return"
import type { AskContext } from "./ask-context"
import {
  askSteps,
  proseFrom,
  toolNamesFrom,
  type AskState,
  type AskTurnView,
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
 *
 * ---------------------------------------------------------------------------
 * IT HOLDS A CONVERSATION NOW, AND THE MEASUREMENT THAT SAYS WHY
 * ---------------------------------------------------------------------------
 *
 * `POST /api/chat` has taken a `conversationId` since it was written, and this
 * hook never sent one: `ask()` cleared the message list before every send, so
 * each question opened a fresh thread and the model was handed no history.
 *
 * That is measurable in the live database rather than a matter of taste. Of 47
 * stored conversations, **40 hold exactly two messages** — one question and
 * one answer — six hold one (a turn that failed before the answer was
 * written), and exactly ONE holds nine. That ninth is not from here; it is
 * from `/m/chat`, the pre-Counter surface, which has always sent the id.
 *
 * So the Ask page drew a rail titled "Conversations" in which every row was a
 * single question, and the model's own follow-up chips — "Which day was
 * weakest?" — were asked COLD, with no idea which week "weakest" referred to.
 * The follow-up is the whole reason to have a chat instead of a report.
 *
 * `follow()` is the fix, and it is a second method rather than a change to
 * `ask()` because the ⌘K palette answers exactly one question (K-R4) and must
 * keep doing so. `ask()` starts a thread; `follow()` adds a turn to it.
 *
 * ---------------------------------------------------------------------------
 * ONLY THE NEW TURN GOES UP THE WIRE
 * ---------------------------------------------------------------------------
 *
 * `prepareSendMessagesRequest` sends `messages.slice(-1)` and the conversation
 * id. The route reads that one-message shape as "you already have the rest"
 * and replays the stored thread itself. The alternative — posting the whole
 * accumulated list — would make the client the authority on what was said,
 * which it is not: the reader can land on `?c=` from the rail with a thread on
 * screen that this hook never saw.
 */
export function useAsk(
  /**
   * The thread this surface is standing in, from `?c=`, or null for a fresh
   * one. Changing it (opening another thread from the rail) drops the live
   * turns — they belong to the thread being left.
   */
  initialConversationId: string | null = null,
): {
  /** Every turn asked in THIS session, oldest first. */
  turns: AskTurnView[]
  /** The most recent turn's state — the palette's whole surface, and the page's headline. */
  state: AskState
  /** The thread these turns belong to, once the route has named it. */
  conversationId: string | null
  /** Start a thread: clears what is on screen and asks with no history. */
  ask: (question: string, context: AskContext) => void
  /** Add a turn to the thread on screen. */
  follow: (question: string, context: AskContext) => void
  reset: () => void
} {
  /*
   * The questions as TYPED, in order. The messages on the wire carry the scope
   * sentence in front of them and the surface must never show the reader that
   * plumbing back, so the typed text is kept here rather than parsed back out
   * of what was sent.
   */
  const [questions, setQuestions] = useState<string[]>([])

  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  /*
   * THE REF IS THE AUTHORITY, and it is deliberately NOT mirrored from state
   * on every render. The transport is built once and reads the id at send
   * time, so it needs a ref; but the id most often arrives inside a `fetch`
   * callback, which sets the ref and defers the `setState` a tick. A
   * render-time `ref.current = conversationId` in between would put the STALE
   * value back, and a follow-up sent in that window would open a second
   * thread. Every place that changes the id writes both, in that order.
   */
  const conversationIdRef = useRef<string | null>(initialConversationId)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            // The new turn only — see the docblock.
            messages: messages.slice(-1),
            conversationId: conversationIdRef.current,
          },
        }),
        fetch: (input, init) =>
          fetch(input as RequestInfo, init).then((res) => {
            /*
             * A thread that is gone — deleted, or on another account. Dropping
             * the id here means the NEXT send takes the route's create branch
             * and starts a fresh thread, rather than 404ing forever against an
             * id the reader cannot see or clear.
             */
            if (res.status === 404 || res.status === 403) {
              conversationIdRef.current = null
              setTimeout(() => setConversationId(null), 0)
              return res
            }
            const id = res.headers.get("x-conversation-id")
            if (id && id !== conversationIdRef.current) {
              conversationIdRef.current = id
              // Next tick: this runs inside the fetch that a render started,
              // and setting state during it would be a render-phase update.
              setTimeout(() => setConversationId(id), 0)
            }
            return res
          }),
      }),
    [],
  )

  const { messages, sendMessage, setMessages, status, error } = useChat({ transport })

  /*
   * A DIFFERENT THREAD ARRIVED IN THE URL.
   *
   * Only when it disagrees with the id this hook is already holding: the
   * common case is the page writing `?c=` from the id we just captured, and
   * treating that as a thread switch would wipe the answer that produced it.
   */
  useEffect(() => {
    if (initialConversationId === conversationIdRef.current) return
    conversationIdRef.current = initialConversationId
    setConversationId(initialConversationId)
    setQuestions([])
    setMessages([])
  }, [initialConversationId, setMessages])

  const send = useCallback(
    (raw: string, context: AskContext, fresh: boolean) => {
      const trimmed = raw.trim()
      if (!trimmed) return
      if (fresh) {
        // Synchronous on the SDK's own store, so the send below starts from an
        // empty list rather than appending to the previous question's turn.
        setMessages([])
        conversationIdRef.current = null
        setConversationId(null)
        setQuestions([trimmed])
      } else {
        setQuestions((q) => [...q, trimmed])
      }
      void sendMessage({ text: `${context.sentence}.\n${trimmed}` })
    },
    [sendMessage, setMessages],
  )

  const ask = useCallback(
    (raw: string, context: AskContext) => send(raw, context, true),
    [send],
  )
  const follow = useCallback(
    (raw: string, context: AskContext) => send(raw, context, false),
    [send],
  )

  const reset = useCallback(() => {
    setQuestions([])
    setMessages([])
    conversationIdRef.current = null
    setConversationId(null)
  }, [setMessages])

  const turns = useMemo<AskTurnView[]>(() => {
    /*
     * The nth assistant message answers the nth question. `useChat` appends
     * one assistant message per turn and parts accumulate onto it, so this
     * pairing holds while a turn is still streaming — which is the point: the
     * turn in flight is the one being watched.
     */
    const answers = messages.filter((m) => m.role === "assistant")

    return questions.map((question, i) => {
      const last = i === questions.length - 1
      const parts = (answers[i]?.parts ?? []) as unknown as ReturnPart[]

      if (last && status === "error") {
        const message = error?.message?.trim()
        return {
          id: `${i}`,
          question,
          state: {
            status: "failed",
            question,
            message: message && message.length > 0 ? message : "The answer never arrived.",
          },
        }
      }

      /*
       * The in-flight turn reads its parts WHILE streaming rather than after:
       * those parts are the reading log the loading state draws. Only the last
       * turn can be in flight — an earlier one has an assistant message that
       * has already settled.
       */
      if (last && (status === "submitted" || status === "streaming")) {
        return { id: `${i}`, question, state: { status: "asking", question, steps: askSteps(parts) } }
      }

      // `ready` with no assistant turn yet is the tick between the send and
      // the SDK moving to `submitted`.
      if (!answers[i]) {
        return { id: `${i}`, question, state: { status: "asking", question, steps: [] } }
      }

      const filed = selectFiledReturn(parts)
      return {
        id: `${i}`,
        question,
        state: {
          status: "answered",
          answer: {
            question,
            filed,
            body: proseFrom(parts),
            read: toolNamesFrom(parts),
            // Nothing filed means nothing to lay out — the empty form is prose
            // and its sources, which is exactly what there is.
            form: filed ? returnForm(filed) : "empty",
          },
        },
      }
    })
  }, [questions, status, error, messages])

  const state = turns.length > 0 ? turns[turns.length - 1].state : { status: "idle" as const }

  return { turns, state, conversationId, ask, follow, reset }
}
