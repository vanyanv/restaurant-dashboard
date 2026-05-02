"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import type { UIMessage } from "ai"
import {
  ChatDrawerProvider,
  useChatDrawer,
} from "@/components/chat/chat-drawer-context"
import {
  hydrateConversationMessages,
  type SavedMessage,
} from "@/lib/chat/hydrate-messages"
import "@/components/chat/chat.css"

const ChatThread = dynamic(
  () => import("@/components/chat/chat-thread").then((m) => m.ChatThread),
  {
    ssr: false,
    loading: () => <MobileChatThreadFallback />,
  },
)

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
    <div className="m-chat-shell" data-perf-ready="/m/chat">
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

function MobileChatThreadFallback() {
  return (
    <>
      <div className="chat-thread">
        <div className="chat-empty">
          <div className="chat-empty__intro">
            <div className="m-skel-line m-skel-line--cap" />
            <div className="m-skel-line m-skel-line--title" />
            <div className="m-skel-line m-skel-line--body" />
          </div>
          <div className="chat-empty__suggestions">
            <div className="m-skel-pill" />
            <div className="m-skel-pill" />
            <div className="m-skel-pill" />
          </div>
        </div>
      </div>
      <div className="chat-input-shell">
        <div className="chat-input-row">
          <div className="m-skel-line m-skel-line--input" />
        </div>
        <div className="chat-input-meta">
          <span className="m-skel-line m-skel-line--meta" />
        </div>
      </div>
    </>
  )
}
