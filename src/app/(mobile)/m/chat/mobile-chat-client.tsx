"use client"

import { useEffect, useState } from "react"
import type { UIMessage } from "ai"
import {
  ChatDrawerProvider,
  useChatDrawer,
} from "@/components/chat/chat-drawer-context"
import { ChatThread } from "@/components/chat/chat-thread"
import {
  hydrateConversationMessages,
  type SavedMessage,
} from "@/lib/chat/hydrate-messages"
import "@/components/chat/chat.css"

type ConversationSummary = {
  id: string
  title: string | null
  updatedAt: string
  messageCount: number
}

export function MobileChatClient({
  conversations,
}: {
  conversations: ConversationSummary[]
}) {
  return (
    <ChatDrawerProvider>
      <MobileChatInner conversations={conversations} />
    </ChatDrawerProvider>
  )
}

function MobileChatInner({
  conversations: initial,
}: {
  conversations: ConversationSummary[]
}) {
  const { conversationId, setConversationId, resetConversation } =
    useChatDrawer()
  const [conversations] = useState(initial)
  const [hydrated, setHydrated] = useState<{
    id: string | null
    messages: UIMessage[]
  }>({ id: null, messages: [] })

  useEffect(() => {
    let cancelled = false
    if (!conversationId) {
      setHydrated({ id: null, messages: [] })
      return
    }
    fetch(`/api/chat/conversations/${conversationId}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) {
            resetConversation()
            setHydrated({ id: null, messages: [] })
          }
          return null
        }
        return r.ok ? r.json() : null
      })
      .then((data) => {
        if (cancelled || !data?.conversation) return
        const msgs: UIMessage[] = hydrateConversationMessages(
          data.conversation.messages as SavedMessage[]
        )
        setHydrated({ id: conversationId, messages: msgs })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [conversationId, resetConversation])

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - 56px - env(safe-area-inset-bottom, 0px) - 18px)",
        margin: "-18px -16px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: "1px solid var(--hairline-bold)",
          background: "rgba(255, 253, 247, 0.55)",
        }}
      >
        <select
          value={conversationId ?? ""}
          onChange={(e) =>
            e.target.value ? setConversationId(e.target.value) : resetConversation()
          }
          aria-label="Conversation"
          className="m-select"
          style={{ flex: 1 }}
        >
          <option value="">+ New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "Untitled"}
            </option>
          ))}
        </select>
        {conversationId ? (
          <button
            type="button"
            onClick={resetConversation}
            className="m-toolbar-btn"
          >
            New
          </button>
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ChatThread
          key={hydrated.id ?? "new"}
          initialMessages={hydrated.messages}
        />
      </div>
    </div>
  )
}
