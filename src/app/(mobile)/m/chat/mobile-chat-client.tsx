"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useState } from "react"
import type { UIMessage } from "ai"
import { Home, List } from "lucide-react"
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
          data.conversation.messages as SavedMessage[],
        )
        setHydrated({ id: conversationId, messages: msgs })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [conversationId, resetConversation])

  useEffect(() => {
    if (!confirmDelete) return
    const id = window.setTimeout(() => setConfirmDelete(false), 4500)
    return () => window.clearTimeout(id)
  }, [confirmDelete])

  useEffect(() => {
    setConfirmDelete(false)
    setDeleteError(null)
  }, [conversationId])

  const handleClear = async () => {
    if (!conversationId || deleting) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      setDeleteError(null)
      return
    }
    const id = conversationId
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      })
      if (res.ok || res.status === 404) {
        setConversations((cs) => cs.filter((c) => c.id !== id))
        resetConversation()
        setHydrated({ id: null, messages: [] })
        setConfirmDelete(false)
      } else {
        setDeleteError("Could not delete this chat. Try again.")
      }
    } catch {
      setDeleteError("Could not delete this chat. Check the connection.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="m-chat-shell m-chat-shell--immersive"
      data-perf-ready="/m/chat"
    >
      <div className="m-chat-toolbar">
        <div className="m-chat-toolbar__nav" aria-label="Chat navigation">
          <Link href="/m" className="m-chat-nav-link" aria-label="Home">
            <Home aria-hidden className="m-chat-nav-link__icon" />
          </Link>
          <Link
            href="/m/more"
            className="m-chat-nav-link"
            aria-label="More sections"
          >
            <List aria-hidden className="m-chat-nav-link__icon" />
          </Link>
        </div>
        <select
          value={conversationId ?? ""}
          onChange={(e) =>
            e.target.value
              ? setConversationId(e.target.value)
              : resetConversation()
          }
          aria-label="Conversation"
          className="m-select"
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">New chat</option>
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
            className={`m-toolbar-btn${confirmDelete ? " m-toolbar-btn--danger" : ""}`}
            disabled={deleting}
            aria-label="Delete this chat"
          >
            {deleting ? "Deleting…" : confirmDelete ? "Confirm" : "Delete"}
          </button>
        ) : null}
      </div>
      {deleteError ? (
        <div className="m-chat-error" role="status">
          {deleteError}
        </div>
      ) : null}
      <div className="m-chat-body">
        <ChatThread
          key={hydrated.id ?? "new"}
          initialMessages={hydrated.messages}
          inputHint="Ask about sales, costs, invoices, or menu prices."
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
