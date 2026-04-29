"use client"

import { useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import { useChatDrawer } from "@/components/chat/chat-drawer-context"
import { ChatThread } from "@/components/chat/chat-thread"
import {
  hydrateConversationMessages,
  type SavedMessage,
} from "@/lib/chat/hydrate-messages"
import "./chat-page.css"

interface ConversationSummary {
  id: string
  title: string | null
  updatedAt: string
  createdAt: string
  messageCount: number
}

interface Props {
  initialConversations: ConversationSummary[]
}

/** Two-column shell for the dedicated chat page: a 280px conversations
 * rail on the left and the same `<ChatThread>` the drawer uses on the
 * right. The thread reads its conversation id from the drawer context, so
 * picking a conversation in the rail repoints the thread to that id. */
export function ChatPageClient({ initialConversations }: Props) {
  const { conversationId, setConversationId, resetConversation } =
    useChatDrawer()
  const [conversations, setConversations] = useState(initialConversations)
  const [hydrated, setHydrated] = useState<{
    id: string | null
    messages: UIMessage[]
  }>({ id: null, messages: [] })
  // Marker set when the active <ChatThread> bubbles up its server-assigned
  // conversation id mid-stream. The hydration effect below skips when the
  // context's conversationId matches this — re-fetching would change the
  // thread's remount key and drop the live "Thinking" state.
  const capturedIdRef = useRef<string | null>(null)

  // Whenever the active conversation id changes, fetch its prior messages
  // so the thread can hydrate. The thread is keyed by conversation id —
  // swapping the key remounts it cleanly and useChat picks up the fresh
  // initialMessages.
  useEffect(() => {
    let cancelled = false
    if (conversationId && conversationId === capturedIdRef.current) {
      // Change came from the in-flight thread itself; consume marker and
      // leave the live useChat state alone.
      capturedIdRef.current = null
      return
    }
    if (!conversationId) {
      setHydrated({ id: null, messages: [] })
      return
    }
    fetch(`/api/chat/conversations/${conversationId}`, { cache: "no-store" })
      .then(async (r) => {
        // Stale id (deleted, cascaded, or owned by a different user). Drop
        // it so the next send creates a fresh thread instead of POSTing
        // /api/chat with a dead id and surfacing "NOT_FOUND" to the owner.
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
  }, [conversationId])

  // Refresh the rail when the tab regains focus — covers the case where
  // another tab created or renamed a conversation. The post-turn refresh
  // is wired through `<ChatThread onTurnFinish>` below.
  useEffect(() => {
    function onFocus() {
      refresh()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  async function refresh() {
    try {
      const res = await fetch("/api/chat/conversations", {
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as { conversations: ConversationSummary[] }
      setConversations(data.conversations)
    } catch {
      /* swallow — non-critical */
    }
  }

  async function newConversation() {
    capturedIdRef.current = null
    resetConversation()
    await refresh()
  }

  async function pick(id: string) {
    capturedIdRef.current = null
    setConversationId(id)
  }

  async function remove(id: string) {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) return
    if (id === conversationId) resetConversation()
    setConversations((rows) => rows.filter((r) => r.id !== id))
  }

  async function rename(id: string, nextTitle: string) {
    const trimmed = nextTitle.trim()
    if (!trimmed) return
    // Optimistic.
    setConversations((rows) =>
      rows.map((r) => (r.id === id ? { ...r, title: trimmed } : r)),
    )
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) {
        // Roll back to server view on failure.
        await refresh()
      }
    } catch {
      await refresh()
    }
  }

  return (
    <div className="chat-page">
      <aside className="chat-page__rail">
        <div className="chat-page__rail-head">
          <div className="chat-drawer__dept">Conversations</div>
          <button
            type="button"
            className="chat-drawer__close"
            onClick={newConversation}
          >
            New
          </button>
        </div>
        <div className="chat-page__list">
          {conversations.length === 0 ? (
            <div className="chat-page__empty-rail">
              No conversations yet. Ask a question to start one.
            </div>
          ) : (
            conversations.map((c) => (
              <RailRow
                key={c.id}
                conversation={c}
                active={c.id === conversationId}
                onPick={() => pick(c.id)}
                onDelete={() => remove(c.id)}
                onRename={(next) => rename(c.id, next)}
              />
            ))
          )}
        </div>
      </aside>
      <section className="chat-page__main">
        <header className="chat-page__main-head">
          <div className="chat-drawer__dept">Owner Analyst · Late edition</div>
          <div className="chat-page__title">Ask the ledger.</div>
        </header>
        <ChatThread
          // Remount the thread whenever the active conversation changes so
          // useChat picks up the new initialMessages.
          key={hydrated.id ?? "new"}
          initialMessages={hydrated.messages}
          onTurnFinish={refresh}
          onConversationCaptured={(id) => {
            capturedIdRef.current = id
            setConversationId(id)
          }}
          onConversationLost={() => {
            capturedIdRef.current = null
            resetConversation()
            setHydrated({ id: null, messages: [] })
          }}
        />
      </section>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

interface RailRowProps {
  conversation: ConversationSummary
  active: boolean
  onPick: () => void
  onDelete: () => void
  onRename: (nextTitle: string) => void
}

/** A single conversation row in the rail. The row itself is a
 * `role="button"` div (not a real `<button>`) so the delete affordance and
 * the inline rename input can live as siblings without nesting buttons —
 * which is invalid HTML and breaks keyboard semantics. */
function RailRow({
  conversation: c,
  active,
  onPick,
  onDelete,
  onRename,
}: RailRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.title ?? "")
  const [pendingDelete, setPendingDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingTimerRef = useRef<number | null>(null)

  // Two-tap delete confirm: first click arms the affordance for ~2.5s, a
  // second click within that window confirms. Avoids the native confirm()
  // dialog and a heavy modal — the icon morphs in place.
  function armOrConfirmDelete() {
    if (pendingDelete) {
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current)
      setPendingDelete(false)
      onDelete()
      return
    }
    setPendingDelete(true)
    pendingTimerRef.current = window.setTimeout(() => {
      setPendingDelete(false)
      pendingTimerRef.current = null
    }, 2500)
  }

  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current)
    }
  }, [])

  // Reset draft whenever the canonical title changes (e.g. after auto-title
  // lands or another tab renamed the conversation).
  useEffect(() => {
    if (!editing) setDraft(c.title ?? "")
  }, [c.title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const next = draft.trim()
    if (next && next !== (c.title ?? "")) onRename(next)
    setEditing(false)
  }

  function cancel() {
    setDraft(c.title ?? "")
    setEditing(false)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        "editorial-nav-item chat-page__rail-item" + (active ? " is-active" : "")
      }
      onClick={() => {
        if (!editing) onPick()
      }}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onPick()
        }
      }}
      aria-current={active ? "true" : undefined}
    >
      <span className="chat-page__rail-date">{formatDate(c.updatedAt)}</span>
      {editing ? (
        <form
          className="chat-page__rail-rename"
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                cancel()
              }
            }}
            aria-label="Rename conversation"
            className="chat-page__rail-rename-input"
          />
        </form>
      ) : (
        <span
          className="chat-page__rail-title"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          onClick={(e) => {
            // Single-click on the title region (not the row) starts edit
            // when the row is already active. Otherwise let the row click
            // through and select the conversation.
            if (active) {
              e.stopPropagation()
              setEditing(true)
            }
          }}
          title="Double-click to rename"
        >
          {c.title ?? "Untitled"}
        </span>
      )}
      <span
        className={
          "chat-page__rail-delete" +
          (pendingDelete ? " is-pending" : "")
        }
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          armOrConfirmDelete()
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            armOrConfirmDelete()
          }
        }}
        aria-label={
          pendingDelete
            ? `Confirm delete ${c.title ?? "conversation"}`
            : `Delete ${c.title ?? "conversation"}`
        }
        title={pendingDelete ? "Click again to confirm" : "Delete"}
      >
        {pendingDelete ? "OK?" : "×"}
      </span>
    </div>
  )
}
