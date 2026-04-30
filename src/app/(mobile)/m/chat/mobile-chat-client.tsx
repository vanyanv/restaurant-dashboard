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
  const [conversations, setConversations] = useState(initial)
  const [hydrated, setHydrated] = useState<{
    id: string | null
    messages: UIMessage[]
  }>({ id: null, messages: [] })
  const [deleting, setDeleting] = useState(false)

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

  const handleClear = async () => {
    if (!conversationId || deleting) return
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this conversation? This cannot be undone.")
    ) {
      return
    }
    const id = conversationId
    setDeleting(true)
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      })
      if (res.ok || res.status === 404) {
        setConversations((cs) => cs.filter((c) => c.id !== id))
        resetConversation()
        setHydrated({ id: null, messages: [] })
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="m-chat-shell">
      <div className="m-chat-toolbar">
        <select
          value={conversationId ?? ""}
          onChange={(e) =>
            e.target.value ? setConversationId(e.target.value) : resetConversation()
          }
          aria-label="Conversation"
          className="m-select"
          style={{ flex: 1, minWidth: 0 }}
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
            onClick={handleClear}
            className="m-toolbar-btn"
            disabled={deleting}
            aria-label="Delete this conversation"
          >
            {deleting ? "…" : "Clear"}
          </button>
        ) : null}
      </div>
      <div className="m-chat-body">
        <ChatThread
          key={hydrated.id ?? "new"}
          initialMessages={hydrated.messages}
        />
      </div>
    </div>
  )
}
