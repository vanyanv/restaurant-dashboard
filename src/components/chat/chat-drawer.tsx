"use client"

import { useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import { useChatDrawer } from "./chat-drawer-context"
import { ChatThread } from "./chat-thread"
import {
  hydrateConversationMessages,
  type SavedMessage,
} from "@/lib/chat/hydrate-messages"

/** Right-side slide-in drawer mounted once at the dashboard layout level.
 * Persists across route changes; opens on ⌘K. The thread/composer inside
 * use the drawer's conversation id so the same thread continues if the
 * owner closes and reopens. On reopen with an existing conversation id we
 * fetch the saved messages and hydrate them — including tool-call output
 * parts so inline cards (TrendCard, InvoiceCard, ...) survive a close. */
export function ChatDrawer() {
  const { open, closeDrawer, resetConversation, conversationId } =
    useChatDrawer()
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false)
  const [hydrated, setHydrated] = useState<{
    id: string | null
    messages: UIMessage[]
  }>({ id: null, messages: [] })
  const [hydrating, setHydrating] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // First open primes the lazy mount. After that we keep the thread
  // mounted (it just toggles visibility) so re-opens are instant.
  useEffect(() => {
    if (open && !hasOpenedOnce) setHasOpenedOnce(true)
  }, [open, hasOpenedOnce])

  // When the drawer opens with an existing conversation, refresh the
  // hydrated message set so inline cards reappear. Skipped while a fresh
  // (no id) thread is in play.
  useEffect(() => {
    if (!open) return
    if (!conversationId) {
      setHydrated({ id: null, messages: [] })
      return
    }
    if (hydrated.id === conversationId) return
    let cancelled = false
    setHydrating(true)
    fetch(`/api/chat/conversations/${conversationId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.conversation) return
        const msgs = hydrateConversationMessages(
          data.conversation.messages as SavedMessage[],
        )
        setHydrated({ id: conversationId, messages: msgs })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrating(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, conversationId, hydrated.id])

  // Focus management: when the drawer opens, capture the previously focused
  // element and move focus into the textarea. While open, trap Tab inside
  // the drawer so keyboard users can't drift to the page behind. On close,
  // restore focus to where it came from (typically the chat trigger).
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null
    const drawer = drawerRef.current
    if (!drawer) return

    const tabbableSelector =
      'a[href]:not([disabled]),button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'

    // Focus the textarea once it mounts. The thread + composer arrive on
    // the next frame after `hasOpenedOnce` flips, so retry briefly.
    let tries = 0
    const focusTextarea = () => {
      const ta = drawer.querySelector<HTMLTextAreaElement>(".chat-input")
      if (ta) {
        ta.focus()
        return
      }
      if (tries++ < 20) requestAnimationFrame(focusTextarea)
    }
    const focusFrame = requestAnimationFrame(focusTextarea)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      const tabbables = Array.from(
        drawer.querySelectorAll<HTMLElement>(tabbableSelector),
      ).filter((el) => el.offsetParent !== null)
      if (tabbables.length === 0) return
      const first = tabbables[0]
      const last = tabbables[tabbables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    drawer.addEventListener("keydown", onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      drawer.removeEventListener("keydown", onKeyDown)
      const restore = restoreFocusRef.current
      if (restore && document.contains(restore)) restore.focus()
    }
  }, [open])

  return (
    <>
      <div
        className={"chat-drawer-backdrop" + (open ? " is-open" : "")}
        onClick={closeDrawer}
        aria-hidden={!open}
      />
      <aside
        ref={drawerRef}
        className={"chat-drawer" + (open ? " is-open" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Owner analytics chat"
        aria-hidden={!open}
      >
        <header className="chat-drawer__header">
          <div>
            <div className="chat-drawer__dept">Owner Analyst · Ask</div>
            <div className="chat-drawer__title">Late-edition.</div>
          </div>
          <div className="chat-drawer__header-actions">
            <button
              type="button"
              className="chat-drawer__close"
              onClick={() => {
                resetConversation()
                setHydrated({ id: null, messages: [] })
              }}
              aria-label="Start a new thread"
            >
              New
            </button>
            <button
              type="button"
              className="chat-drawer__close"
              onClick={closeDrawer}
              aria-label="Close chat"
            >
              Close · Esc
            </button>
          </div>
        </header>
        {/* Lazy first mount; after that we re-key on conversationId so
            switching threads (or hitting "New") gives useChat fresh
            initialMessages. The hydrating flag lets us keep a calm
            placeholder while the prior conversation's messages load. */}
        {hasOpenedOnce && !hydrating && (
          <ChatThread
            key={hydrated.id ?? "new"}
            initialMessages={hydrated.messages}
          />
        )}
        {hasOpenedOnce && hydrating && (
          <div className="chat-thread" aria-busy>
            <div className="chat-message">
              <span className="chat-message__role">Assistant</span>
              <div className="chat-message__body chat-message__body--assistant">
                Loading conversation…
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
