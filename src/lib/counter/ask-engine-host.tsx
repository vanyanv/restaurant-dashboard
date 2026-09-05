"use client"

import { useEffect } from "react"
import { useAsk } from "./use-ask"

/** Everything `useAsk` returns, as one value a host can publish upward. */
export type AskEngine = ReturnType<typeof useAsk>

/**
 * The model wiring as a mountable, invisible component.
 *
 * This file is the second of the two places `@ai-sdk/react` and `ai` enter a
 * client bundle (`components/counter/ask/ask-mount.tsx` is the first, for the
 * ⌘K palette). It exists for the same reason ask-mount does: a hook cannot be
 * lazily imported, but a component that CALLS the hook can. The two Ask pages
 * render this through `next/dynamic` (see `use-ask-deferred.tsx`) so the SDK
 * rides in an async chunk that starts loading at hydration instead of sitting
 * in the routes' first-load JavaScript.
 *
 * It renders nothing. Its whole output is the `onEngine` callback, re-fired
 * whenever the conversation's data changes — the effect deps are the three
 * DATA halves of the engine (`useAsk`'s callbacks are stable), so a parent
 * storing the engine in state re-renders exactly as often as it did when it
 * called `useAsk` directly.
 */
export function AskEngineHost({
  initialConversationId,
  onEngine,
}: {
  initialConversationId: string | null
  onEngine: (engine: AskEngine) => void
}) {
  const engine = useAsk(initialConversationId)

  useEffect(() => {
    onEngine(engine)
    // Deps are the four DATA halves on purpose: `ask`/`follow`/`stop`/`reset`
    // are stable useCallbacks inside useAsk, and publishing on every render
    // would loop through the parent's setState. `askedAt` joins them because
    // the turn footer counts live seconds from it; it moves once per question,
    // not per tick, so it costs one extra publish per send.
  }, [engine.turns, engine.state, engine.conversationId, engine.askedAt, onEngine])

  return null
}
