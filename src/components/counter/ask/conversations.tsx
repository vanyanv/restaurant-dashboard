"use client"

import type { AskConversation } from "@/lib/counter/adapters/ask"

/**
 * The `.convs` rail — what this account has already asked.
 *
 * Ported from the prototype's Ask page, which is a two-column `.askpage`:
 * a 206px rail beside the answer. The CSS has been in
 * `counter-components.css` since the page shipped — `.convs`, `.convs__h`,
 * `.cv`, `.cv[aria-current]` with its accent left border — and nothing
 * emitted any of it.
 *
 * ## Why it was left out, and why that reason expired
 *
 * The page said so in its own words: *"there is no thread store behind it: a
 * sidebar of conversations would be four buttons that cannot restore
 * anything."* Correct when written. But `POST /api/chat` has called
 * `createConversation` and `appendMessage` on every Ask since, and the live
 * database held **39 conversations** with model-written titles and turn
 * counts by the time this was built. The rail was never waiting on a backend.
 *
 * ## What a row can honestly offer
 *
 * `ChatTurn` persists `userMessage`, `assistantMessage` and `toolsUsed` — the
 * question, the prose, and what was read. It does NOT persist the
 * `FiledReturn`, so a restored thread has no figures and this rail must not
 * promise any. Selecting a row opens that thread; the strip that was on
 * screen when it was first answered is gone and is not reconstructed from
 * guesses.
 *
 * ## The markup is the sheet's
 *
 *   <div class="convs">
 *     <div class="convs__h"><span>Conversations</span><button>New</button>
 *     <button class="cv" aria-current="true"><b>title</b><span>meta</span>
 *
 * `aria-current` is the prototype's own selector for the active row
 * (`.cv[aria-current="true"]` paints the accent left border), so it is both
 * the style hook and the correct assistive announcement — one attribute doing
 * the job it is actually for.
 */
export function Conversations({
  items,
  currentId,
  onOpen,
  onNew,
}: {
  items: AskConversation[]
  /** The thread being read, if any — marks the row and paints its border. */
  currentId: string | null
  onOpen: (id: string) => void
  onNew: () => void
}) {
  return (
    <div className="convs">
      <div className="convs__h">
        <span>Conversations</span>
        <button type="button" onClick={onNew}>
          New
        </button>
      </div>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className="cv"
          /*
           * The attribute is only PRESENT on the current row. `aria-current`
           * is not a boolean that can usefully be "false": the prototype's
           * selector is `[aria-current="true"]`, and emitting `false` on
           * thirty-nine rows would announce each of them as a current-ness
           * decision rather than saying nothing about them at all.
           */
          {...(c.id === currentId ? { "aria-current": true as const } : {})}
          onClick={() => onOpen(c.id)}
        >
          <b>{c.title ?? "Untitled"}</b>
          <span>{metaFor(c)}</span>
        </button>
      ))}
    </div>
  )
}

/** `Aug 21 · 2 turns` — the prototype's own second line. */
function metaFor(c: AskConversation): string {
  const when = new Date(c.updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
  // A thread with one turn is not "1 turns". The rail is dense enough that a
  // wrong plural is the first thing the eye catches.
  return `${when} · ${c.turns} ${c.turns === 1 ? "turn" : "turns"}`
}
