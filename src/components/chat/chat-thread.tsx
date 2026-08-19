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
}: Props = {}) {
  const { conversationId } = useChatDrawer()
  const [seedText, setSeedText] = useState<string | undefined>(undefined)
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

  const send = (text: string) => {
    const scoped = buildScopedMessage(text, scope)
    if (!scoped) return
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
      if (e.key === "Escape") stop()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [isStreaming, stop])

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
  const errorText = error ? friendlyError(error.message) : null

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
            <ChatEmpty
              onSelect={(s) => {
                setSeedText(s)
                send(s)
              }}
            />
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
                  onBranch={
                    m.role === "assistant" && !isStreaming && serverMessageIds.has(m.id)
                      ? () => void branchFrom(m.id)
                      : undefined
                  }
                />
              )
            })
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
              <button type="button" className="chat-pill chat-pill--stop" onClick={() => stop()}>
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
        error={errorText}
        initialText={seedText}
        metaHint={inputHint}
        stores={stores}
        scope={scope}
        onScopeChange={setScope}
      />
    </>
  )
}

/** Translate the AI SDK's raw error.message (often the JSON error body or an
 * HTTP status) into one short, owner-facing line. The 404 case is recovered
 * upstream — by the time it surfaces here, the next send will already land
 * on a fresh conversation, so the message just acknowledges the hiccup. */
function friendlyError(raw: string | undefined): string {
  if (!raw) return "Something went wrong."
  const lower = raw.toLowerCase()
  if (lower.includes("not_found") || lower.includes("not found")) {
    return "That thread is gone — try again to start a new one."
  }
  if (lower.includes("not_owned") || lower.includes("forbidden")) {
    return "You don't have access to this thread."
  }
  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "Please sign in again."
  }
  return raw
}
