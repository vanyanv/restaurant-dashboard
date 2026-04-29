"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

interface ChatDrawerState {
  open: boolean
  /** Server-assigned conversation id once the first turn lands. The
   * /api/chat route sets `x-conversation-id` on its streamed response so
   * the client can pin it. */
  conversationId: string | null
  /** Owner's preferred view for trend artifacts (`<TrendCard>`). Per
   *  drawer-session only — not server-persisted. Defaults to "table". */
  trendView: "table" | "chart"
}

interface ChatDrawerCtx extends ChatDrawerState {
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
  setConversationId: (id: string | null) => void
  resetConversation: () => void
  setTrendView: (v: "table" | "chart") => void
}

const Ctx = createContext<ChatDrawerCtx | null>(null)

const DRAWER_CONV_LS_KEY = "chat:drawerConversationId"

export function ChatDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ChatDrawerState>({
    open: false,
    conversationId: null,
    trendView: "table",
  })

  // Restore the last drawer conversation id from localStorage on first
  // mount so a reload doesn't drop the active thread. Wrapped in try/catch
  // to tolerate disabled storage (Safari private mode, etc.).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAWER_CONV_LS_KEY)
      if (saved) setState((s) => ({ ...s, conversationId: saved }))
    } catch {
      /* ignore */
    }
  }, [])

  // Mirror conversationId to localStorage whenever it changes.
  useEffect(() => {
    try {
      if (state.conversationId) {
        window.localStorage.setItem(DRAWER_CONV_LS_KEY, state.conversationId)
      } else {
        window.localStorage.removeItem(DRAWER_CONV_LS_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [state.conversationId])

  const openDrawer = useCallback(
    () => setState((s) => ({ ...s, open: true })),
    [],
  )
  const closeDrawer = useCallback(
    () => setState((s) => ({ ...s, open: false })),
    [],
  )
  const toggleDrawer = useCallback(
    () => setState((s) => ({ ...s, open: !s.open })),
    [],
  )
  const setConversationId = useCallback(
    (id: string | null) => setState((s) => ({ ...s, conversationId: id })),
    [],
  )
  const resetConversation = useCallback(
    () => setState((s) => ({ ...s, conversationId: null })),
    [],
  )
  const setTrendView = useCallback(
    (v: "table" | "chart") => setState((s) => ({ ...s, trendView: v })),
    [],
  )

  // ⌘K / Ctrl+K toggles the drawer. Esc closes when open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault()
        toggleDrawer()
      } else if (e.key === "Escape") {
        setState((s) => (s.open ? { ...s, open: false } : s))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleDrawer])

  const value = useMemo<ChatDrawerCtx>(
    () => ({
      ...state,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      setConversationId,
      resetConversation,
      setTrendView,
    }),
    [
      state,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      setConversationId,
      resetConversation,
      setTrendView,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChatDrawer(): ChatDrawerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useChatDrawer must be used inside ChatDrawerProvider")
  return ctx
}
