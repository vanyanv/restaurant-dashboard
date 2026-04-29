"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { useChatDrawer } from "./chat-drawer-context"
import { ChatEmpty } from "./chat-empty"
import { ChatInput } from "./chat-input"
import { ChatMessage } from "./chat-message"

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
}: Props = {}) {
  const { conversationId } = useChatDrawer()
  const [seedText, setSeedText] = useState<string | undefined>(undefined)
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

  // Stash the latest conversation id in a ref so the transport can attach
  // it to every outgoing request without forcing a remount.
  const conversationIdRef = useRef<string | null>(conversationId)
  conversationIdRef.current = conversationId

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

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: initialMessages,
  })

  const send = (text: string) => {
    sendMessage({ text })
  }

  // Auto-scroll to bottom on new content.
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

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

  const isStreaming = status === "submitted" || status === "streaming"
  const hasMessages = messages.length > 0
  const errorText = error ? error.message || "Something went wrong." : null

  return (
    <>
      <div className="chat-thread" ref={scrollerRef}>
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
            const streamingThis = isStreaming && isLast && m.role === "assistant"
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
              />
            )
          })
        )}
      </div>
      <ChatInput
        onSubmit={send}
        disabled={isStreaming}
        isStreaming={isStreaming}
        error={errorText}
        initialText={seedText}
      />
    </>
  )
}
