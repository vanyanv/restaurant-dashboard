"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChatDrawer } from "./chat-drawer-context"
import { ChatEmpty } from "./chat-empty"
import { ChatInput } from "./chat-input"
import { ChatMessage } from "./chat-message"
import { selectFiledReturn, type ReturnPart } from "@/lib/chat/return"
import { isNearBottom, shouldAutoScroll } from "@/lib/chat/thread-scroll"
import { buildScopedMessage, type ComposerScope } from "@/lib/chat/composer"
import { describeChatError } from "@/lib/chat/describe-error"

interface Props {
  /** When set, the thread hydrates from this list of past messages on
   * first mount. Pair with a unique `key` on the parent so swapping
   * conversations triggers a remount. */
  initialMessages?: UIMessage[]
  /** Fires once per assistant turn after the model finishes streaming.
   * Used by the chat page to refresh its conversation rail without
   * polling. */
  onTurnFinish?: () => void
  /** Fires the first time the server-assigned conversation id arrives on
   * an in-flight stream's `x-conversation-id` header. The parent surface
   * uses this to update its drawer-context id without triggering its own
   * hydration effect — re-fetching here would change the thread's remount
   * key and drop the live `useChat` streaming state mid-turn. */
  onConversationCaptured?: (id: string) => void
  /** Fires when /api/chat returns 404 for the pinned conversation id —
   * meaning the conversation was deleted server-side (or was never owned
   * by the caller). Parent surfaces clear their context id so the next
   * send creates a fresh conversation instead of failing again. */
  onConversationLost?: () => void
  /** Fires with the new conversation id after a turn is branched. */
  onBranched?: (id: string) => void
  inputHint?: string
  /** Stores the owner runs, for the composer's scope chips. */
  stores?: Array<{ id: string; name: string }>
  /** Lean composer for the mobile surface. */
  compact?: boolean
}

/** Wraps `useChat` for the drawer + page surfaces. Exports a single
 * component that renders the message list, empty state, and composer.
 *
 * Capture-the-conversation-id pattern: the /api/chat route writes the
 * server-assigned conversation id to the `x-conversation-id` response
 * header. We override `fetch` so the response can be inspected for that
 * header before the body is consumed by the transport. */
export function ChatThread({
  initialMessages,
  onTurnFinish,
  onConversationCaptured,
  onConversationLost,
  onBranched,
  inputHint,
  stores,
  compact,
}: Props = {}) {
  const { conversationId } = useChatDrawer()
  const [scope, setScope] = useState<ComposerScope>({
    storeName: null,
    from: null,
    to: null,
  })
  // Hold the latest onTurnFinish in a ref so the status-watching effect
  // doesn't need it as a dependency (which would re-run on every prop
  // change and could double-fire).
  const onTurnFinishRef = useRef(onTurnFinish)
  onTurnFinishRef.current = onTurnFinish
  // Same trick for onConversationCaptured so the transport useMemo doesn't
  // re-run (and replace the in-flight transport) when the parent passes a
  // fresh inline callback.
  const onConversationCapturedRef = useRef(onConversationCaptured)
  onConversationCapturedRef.current = onConversationCaptured
  const onConversationLostRef = useRef(onConversationLost)
  onConversationLostRef.current = onConversationLost

  // Stash the latest conversation id in a ref so the transport can attach
  // it to every outgoing request without forcing a remount.
  const conversationIdRef = useRef<string | null>(conversationId)
  conversationIdRef.current = conversationId

  // Ids that came from the server. Only these can be branched: a live turn's
  // id is generated client-side by the AI SDK and matches no Message row, so
  // offering Branch on one would 404.
  const serverMessageIds = useMemo(
    () => new Set((initialMessages ?? []).map((m) => m.id)),
    [initialMessages],
  )

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id }) => ({
          body: {
            messages,
            id,
            conversationId: conversationIdRef.current,
          },
        }),
        fetch: (input, init) =>
          fetch(input as RequestInfo, init).then((res) => {
            // Stale conversation id (deleted server-side, or owned by a
            // different account). Clear the ref + bubble up so the parent
            // surface drops its context id; the very next send will hit
            // the route's create-conversation branch and start fresh.
            if (res.status === 404 && conversationIdRef.current) {
              conversationIdRef.current = null
              setTimeout(() => onConversationLostRef.current?.(), 0)
              return res
            }
            const id = res.headers.get("x-conversation-id")
            if (id && id !== conversationIdRef.current) {
              conversationIdRef.current = id
              // Defer to next tick so we don't update parent state during render.
              setTimeout(() => onConversationCapturedRef.current?.(id), 0)
            }
            return res
          }),
      }),
    [],
  )

  const { messages, sendMessage, status, error, stop, regenerate } = useChat({
    transport,
    messages: initialMessages,
  })

  const isStreaming = status === "submitted" || status === "streaming"

  useEffect(() => {
    if (isStreaming && runStartedRef.current === null) {
      runStartedRef.current = Date.now()
    } else if (!isStreaming) {
      runStartedRef.current = null
    }
  }, [isStreaming])

  /** Stop, and mark the turn it stopped so the partial is legible as partial. */
  const stopRun = useCallback(() => {
    const started = runStartedRef.current
    const last = [...messages].reverse().find((m) => m.role === "assistant")
    stop()
    if (last) {
      setInterrupted({
        id: last.id,
        seconds: started ? `${((Date.now() - started) / 1000).toFixed(1)}s` : "",
      })
    }
  }, [messages, stop])

  const send = (text: string) => {
    const scoped = buildScopedMessage(text, scope)
    if (!scoped) return
    setInterrupted(null)
    void sendMessage({ text: scoped })
  }

  // --- scroll ---------------------------------------------------------
  // The rule: never fight a scroll-up. `stuckRef` tracks whether the reader
  // is parked at the bottom; new content only pulls the viewport when they
  // are. Scrolling up mid-answer releases the lock and raises the pill.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const stuckRef = useRef(true)
  const firstPaintRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  // Which assistant turn the owner stopped, and how long it had run. A partial
  // answer that is not marked as partial reads as a complete one that simply
  // stopped making sense.
  const [interrupted, setInterrupted] = useState<{ id: string; seconds: string } | null>(null)
  const runStartedRef = useRef<number | null>(null)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    stuckRef.current = true
    setShowJump(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const near = isNearBottom(el)
    stuckRef.current = near
    setShowJump(!near)
  }, [])

  useEffect(() => {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      // Nothing to catch up to on an empty thread, and the first-paint rule
      // would otherwise scroll the docket's masthead and headline off the top.
      if (messages.length === 0) return
      if (
        !shouldAutoScroll({
          stuck: stuckRef.current,
          isStreaming,
          firstPaint: firstPaintRef.current,
        })
      ) {
        return
      }
      firstPaintRef.current = false
      const el = scrollerRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
    })
  }, [messages, isStreaming])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    }
  }, [])

  // Fire `onTurnFinish` once per turn — when status transitions from an
  // active state (`submitted` / `streaming`) back to `ready`. The chat
  // page uses this to refresh its conversation rail in place of polling.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    const active = status === "submitted" || status === "streaming"
    if (!active && wasActiveRef.current) {
      wasActiveRef.current = false
      onTurnFinishRef.current?.()
    } else if (active) {
      wasActiveRef.current = true
    }
  }, [status])

  // Esc stops a run in flight. Matches the composer's own Esc handling,
  // which only clears a draft when there is one.
  useEffect(() => {
    if (!isStreaming) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") stopRun()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [isStreaming, stopRun])

  async function branchFrom(messageId: string) {
    const cid = conversationIdRef.current
    if (!cid) return
    try {
      const res = await fetch(`/api/chat/conversations/${cid}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ throughMessageId: messageId }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { id: string }
      onBranched?.(data.id)
    } catch {
      /* leave the thread as it is — branching is additive */
    }
  }

  const hasMessages = messages.length > 0
  const errorNotice = error ? describeChatError(error.message) : null

  // Follow-ups hang off the newest settled answer only. On older turns they
  // would be stale suggestions about a question two answers back.
  const lastAssistant = !isStreaming
    ? [...messages].reverse().find((m) => m.role === "assistant")
    : undefined
  const followUps = lastAssistant
    ? (selectFiledReturn(lastAssistant.parts as unknown as ReturnPart[])?.followUps ?? [])
    : []

  return (
    <>
      <div className="chat-thread-wrap">
        <div className="chat-thread" ref={scrollerRef} onScroll={handleScroll}>
          {!hasMessages ? (
            // Send straight off; seeding the composer too would leave the
            // question sitting in the box after it had already been asked.
            <ChatEmpty onSelect={(s) => send(s)} />
          ) : (
            messages.map((m, idx) => {
              const isLast = idx === messages.length - 1
              const streamingThis =
                isStreaming && isLast && m.role === "assistant"
              // 1-based ordinal of this assistant turn, stamped on the return's
              // head so an answer can be referred to by number within a thread.
              const turnNo =
                m.role === "assistant"
                  ? messages.slice(0, idx + 1).filter((x) => x.role === "assistant").length
                  : undefined
              // Cap stagger index so a long thread's reveal doesn't grow into
              // a multi-second wave. After the sixth row, every reveal lands
              // at the same time as the chat-thread fade.
              const msgIdx = Math.min(idx, 5)
              return (
                <ChatMessage
                  key={m.id}
                  role={m.role}
                  parts={m.parts as never}
                  isStreaming={streamingThis}
                  msgIdx={msgIdx}
                  turnNo={turnNo}
                  onRetry={
                    m.role === "assistant" && !isStreaming
                      ? () => void regenerate({ messageId: m.id })
                      : undefined
                  }
                  interruptedAfter={
                    interrupted?.id === m.id ? interrupted.seconds : undefined
                  }
                  onContinue={
                    interrupted?.id === m.id
                      ? () => send("Continue from where you stopped.")
                      : undefined
                  }
                  createdAt={
                    (m as { metadata?: { createdAt?: string } }).metadata?.createdAt
                  }
                  onBranch={
                    m.role === "assistant" && !isStreaming && serverMessageIds.has(m.id)
                      ? () => void branchFrom(m.id)
                      : undefined
                  }
                />
              )
            })
          )}

          {errorNotice && (
            <div className="chat-notice" role="alert">
              <div>
                <div className="chat-notice__title">{errorNotice.title}</div>
                <div className="chat-notice__detail">{errorNotice.detail}</div>
              </div>
              {errorNotice.retryLabel && (
                <button
                  type="button"
                  className="chat-notice__action"
                  onClick={() => {
                    if (errorNotice.retryKind === "new-thread") {
                      onConversationLost?.()
                    } else {
                      void regenerate()
                    }
                  }}
                >
                  {errorNotice.retryLabel}
                </button>
              )}
            </div>
          )}

          {/* Announced politely so a screen reader hears the answer land
              without having the whole stream read over the reader. */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {isStreaming ? "Answering." : hasMessages ? "Answer ready." : ""}
          </div>
        </div>

        {(isStreaming || showJump) && (
          <div className="chat-floaty">
            {isStreaming ? (
              <button type="button" className="chat-pill chat-pill--stop" onClick={stopRun}>
                <span className="live-dot" aria-hidden />
                Stop generating
                <span className="kbd-chip">Esc</span>
              </button>
            ) : (
              <button
                type="button"
                className="chat-pill"
                onClick={() => scrollToBottom(true)}
              >
                ↓ Jump to latest
              </button>
            )}
          </div>
        )}
      </div>

      {followUps.length > 0 && (
        <div className="chat-followups">
          {followUps.map((q) => (
            <button key={q} type="button" className="chat-followup" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <ChatInput
        onSubmit={send}
        disabled={isStreaming}
        isStreaming={isStreaming}
        error={null}
        metaHint={inputHint}
        stores={stores}
        scope={scope}
        onScopeChange={setScope}
        compact={compact}
      />
    </>
  )
}
