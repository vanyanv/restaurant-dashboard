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
}

/** Wraps `useChat` for the drawer + page surfaces. Exports a single
 * component that renders the message list, empty state, and composer.
 *
 * Capture-the-conversation-id pattern: the /api/chat route writes the
 * server-assigned conversation id to the `x-conversation-id` response
 * header. We override `fetch` so the response can be inspected for that
 * header before the body is consumed by the transport. */
export function ChatThread({ initialMessages }: Props = {}) {
  const { conversationId, setConversationId } = useChatDrawer()
  const [seedText, setSeedText] = useState<string | undefined>(undefined)

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
              setTimeout(() => setConversationId(id), 0)
            }
            return res
          }),
      }),
    [setConversationId],
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
