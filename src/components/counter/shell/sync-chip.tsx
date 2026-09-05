"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"

/**
 * `syncChip()`, prototype line 8702:
 *
 * ```
 * <span class="sync is-bad"><i aria-hidden="true"></i> Last sync failed 4h ago
 * <span class="sync">        <i aria-hidden="true"></i> Syncing…
 * <span class="sync">        <i aria-hidden="true"></i> Synced 12 min ago
 * ```
 *
 * The `<i>` is the dot — `.sync i` is a 6px circle painted `--good`, and the
 * `is-stale` / `is-bad` modifiers repaint it `--signal` / `--bad`. It is the
 * only piece of colour in the topbar, which is why it carries `aria-hidden` and
 * the state is also in the words beside it.
 *
 * The prototype's states are demo states (`UI.state`). Ours are derived from
 * one fact the caller actually has — when the last sync SUCCEEDED — and
 * nothing here invents a duration: `syncing` is a caller assertion, `stale`
 * is the caller's judgment on the age (see `getShellStatus`), and the caller
 * is expected to pass `at` for the rest. A topbar with no sync source at all
 * renders no chip rather than a green dot that means nothing.
 *
 * Motion (D5, D6). `syncing` breathes the dot: the one loop allowed here, and
 * bounded, because it ends when the sync does. The moment a `syncing` chip
 * becomes `synced` the dot rings once in the good colour (`is-ringing`, 1.2s)
 * and the words cross-fade, so the reader learns the figures are fresh
 * without a toast. `stale` is a state, not an event: the dot turns to the
 * signal colour and stays; nothing loops, because stale does not need the
 * reader this minute. All of it is in counter-repairs.css.
 */

export type SyncState = "synced" | "syncing" | "failed" | "stale"

function relative(at: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** True for the ring's own length after `state` goes from syncing to synced. */
function useLanded(state: SyncState): boolean {
  const reduced = useReducedMotion()
  const prev = useRef(state)
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    const was = prev.current
    prev.current = state
    if (reduced || !(was === "syncing" && state === "synced")) return
    setLanded(true)
    const t = setTimeout(() => setLanded(false), 1300)
    return () => clearTimeout(t)
  }, [state, reduced])
  return landed
}

export function SyncChip({
  state,
  at,
  now,
}: {
  state: SyncState
  at?: Date
  now: Date
}) {
  const landed = useLanded(state)
  const when = at ? ` ${relative(at, now)}` : ""

  const text =
    state === "syncing"
      ? "Syncing…"
      : state === "failed"
        ? `Last sync failed${when}`
        : state === "stale"
          ? `Figures${at ? ` ${relative(at, now).replace(/ ago$/, " old")}` : " are old"}`
          : `Synced${when}`

  const cls = [
    "sync",
    state === "syncing" ? "is-syncing" : null,
    state === "failed" ? "is-bad" : null,
    state === "stale" ? "is-stale" : null,
    landed ? "is-ringing" : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <span className={cls}>
      <i aria-hidden="true" />
      {/* Keyed on the words: a change remounts the span, and the generated
          sheet's entry fade is the cross-fade. */}
      <span className="sync__t" key={text}>
        {" "}
        {text}
      </span>
    </span>
  )
}
