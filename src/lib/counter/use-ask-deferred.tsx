"use client"

import dynamic from "next/dynamic"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import type { AskContext } from "./ask-context"
import type { AskEngine } from "./ask-engine-host"

/**
 * `useAsk`, minus the AI SDK in the first load.
 *
 * The two Ask PAGES used to import `useAsk` directly, which put `@ai-sdk/react`
 * and `ai` — ~430 KB uncompressed, ~120 KB gzipped — in `/dashboard/ask` and
 * `/m/ask`'s initial JavaScript. This hook has the same contract, but the SDK
 * lives behind `next/dynamic`: the page's own markup server-renders and
 * hydrates without it, and `AskEngineHost` (an invisible component) starts
 * loading at hydration and publishes the real engine up when it arrives —
 * the same "ready long before a reader reaches for it" argument ask-mount.tsx
 * makes for the ⌘K palette.
 *
 * The gap between hydration and the engine chunk landing is real but narrow,
 * and it is bridged rather than ignored: `ask`/`follow` called in that window
 * buffer ONE pending question (the `?q=` auto-ask effect fires exactly once on
 * mount, so one is the capacity that matters) and the flush replays it the
 * moment the engine publishes. `reset` in that window clears the buffer, which
 * is what reset means when nothing has been sent yet.
 *
 * The returned callbacks are identity-STABLE across the engine's arrival —
 * they delegate through a ref — so page effects keyed on `ask`'s identity do
 * not re-fire when the chunk lands. (`counter-ask-client`'s `askedRef` would
 * tolerate that anyway; not making it happen is still simpler to reason
 * about.)
 *
 * Render `engineMount` anywhere in the page's JSX — it draws nothing.
 */
export function useAskDeferred(initialConversationId: string | null): AskEngine & {
  engineMount: ReactNode
} {
  const engineRef = useRef<AskEngine | null>(null)
  const pendingRef = useRef<
    { mode: "ask" | "follow"; question: string; context: AskContext } | null
  >(null)

  const [snapshot, setSnapshot] = useState<{
    turns: AskEngine["turns"]
    state: AskEngine["state"]
    conversationId: string | null
    askedAt: number | null
  }>({
    turns: [],
    state: { status: "idle" },
    conversationId: initialConversationId,
    askedAt: null,
  })

  const onEngine = useCallback((engine: AskEngine) => {
    const first = engineRef.current === null
    engineRef.current = engine
    if (first && pendingRef.current) {
      const p = pendingRef.current
      pendingRef.current = null
      if (p.mode === "ask") engine.ask(p.question, p.context)
      else engine.follow(p.question, p.context)
      // The send mutates the engine's state; the host republishes it on its
      // next render, so this (already stale) snapshot is set and immediately
      // superseded rather than skipped — skipping would leave the page idle
      // until the first stream tick.
    }
    setSnapshot({
      turns: engine.turns,
      state: engine.state,
      conversationId: engine.conversationId,
      askedAt: engine.askedAt,
    })
  }, [])

  const ask = useCallback((question: string, context: AskContext) => {
    if (engineRef.current) engineRef.current.ask(question, context)
    else pendingRef.current = { mode: "ask", question, context }
  }, [])

  const follow = useCallback((question: string, context: AskContext) => {
    if (engineRef.current) engineRef.current.follow(question, context)
    else pendingRef.current = { mode: "follow", question, context }
  }, [])

  const reset = useCallback(() => {
    if (engineRef.current) engineRef.current.reset()
    else pendingRef.current = null
  }, [])

  /*
   * Before the engine lands there is no stream to cut, so the only thing
   * `stop` can mean is "drop the question that is waiting to be sent" — the
   * same reading `reset` takes above. A reader who presses stop in that window
   * gets what they asked for: nothing is sent when the chunk arrives.
   */
  const stop = useCallback(() => {
    if (engineRef.current) engineRef.current.stop()
    else pendingRef.current = null
  }, [])

  const engineMount = useMemo(
    () => (
      <AskEngineHost
        initialConversationId={initialConversationId}
        onEngine={onEngine}
      />
    ),
    [initialConversationId, onEngine],
  )

  return {
    turns: snapshot.turns,
    state: snapshot.state,
    // Until the engine exists nothing can have renamed the thread, so the
    // address bar's value IS the conversation id — and `useAsk` seeds from
    // the same prop when it arrives.
    conversationId: engineRef.current ? snapshot.conversationId : initialConversationId,
    ask,
    follow,
    stop,
    // Null until the engine sends: nothing has been asked, so the turn footer's
    // live seconds have no anchor to count from yet.
    askedAt: snapshot.askedAt,
    reset,
    engineMount,
  }
}

/**
 * `ssr: false` because the host renders null and exists only for its client
 * hook — server-rendering it would drag the SDK back into the page's server
 * graph for no markup.
 */
const AskEngineHost = dynamic(
  () => import("./ask-engine-host").then((m) => m.AskEngineHost),
  { ssr: false },
)
