"use client"

import type { ReactNode } from "react"
import { SearchGlyph } from "@/components/counter/surface/search-glyph"
import type { AskConversation } from "@/lib/counter/adapters/ask"
import { groupThreadsByDay, threadTurnLabel } from "@/lib/counter/thread-groups"

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
/**
 * THE SHELL — the box, its header, "New", and the search field.
 *
 * Separate from the rows because the rows live inside a `<Section>`, and a
 * `Section` whose data is empty renders `Empty` INSTEAD of its children. With
 * the search field inside them, searching for something that matches nothing
 * would take the search field off screen along with the rows, and the reader
 * would have no way back except the browser's own history. The control that
 * caused a state has to survive that state.
 */
export function ConversationsRail({
  query,
  onQuery,
  onNew,
  children,
}: {
  /** What is being searched for, from `?cq=`. */
  query: string
  onQuery: (next: string) => void
  onNew: () => void
  /** The `<Section>` holding the rows. */
  children: ReactNode
}) {
  return (
    <div className="convs">
      <div className="convs__h">
        <span>Conversations</span>
        <button type="button" onClick={onNew}>
          New
        </button>
      </div>
      {/*
        * `.convs__q` — the one thing on this rail the prototype does not have,
        * because the prototype's rail is four hand-written threads and this
        * one is however many the account has asked. `searchConversations`
        * matches TITLES AND TURN TEXT, so a thread the reader remembers by a
        * number in its answer is reachable; a rail of auto-generated titles
        * alone is not.
        */}
      <label className="convs__q">
        <SearchGlyph />
        <input
          type="search"
          value={query}
          placeholder="Search threads"
          aria-label="Search conversations"
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      {children}
    </div>
  )
}

/**
 * The rows themselves — one `.cv` per thread, under a `.cvgrp` day heading.
 *
 * ## The second line used to say nothing
 *
 * Every row read `Aug 28 · 1 turn`. The turn count is 1 for 40 of the
 * account's 47 threads (the adapter says so in its own note), so it appeared
 * on almost every row and separated none of them; and six consecutive rows
 * repeating `Sep 1` under six titles that all begin "weekly sales" is a date
 * printed as decoration rather than as a way to find anything.
 *
 * So the date is hoisted into a heading over the run of rows it covers, and
 * the turn count is drawn only when a thread was actually returned to. A
 * single-exchange row is now its title and nothing else, which is also what
 * makes the multi-turn ones visible at a glance. See
 * `@/lib/counter/thread-groups`.
 *
 * `today` comes down from the page rather than from `new Date()` here: the
 * word "Today" must be decided once, on the server, or the server and the
 * client can disagree about it across a hydration.
 */
export function Conversations({
  items,
  currentId,
  today,
  onOpen,
}: {
  items: AskConversation[]
  /** The thread being read, if any — marks the row and paints its border. */
  currentId: string | null
  /** The one `today` this page resolved, for "Today" / "Yesterday". */
  today: Date
  onOpen: (id: string) => void
}) {
  return (
    <>
      {groupThreadsByDay(items, today).map((group) => (
        <div key={group.label}>
          <div className="cvgrp">{group.label}</div>
          {group.items.map((c) => {
            const turns = threadTurnLabel(c.turns)
            return (
              <button
                key={c.id}
                type="button"
                className="cv"
                /*
                 * The attribute is only PRESENT on the current row.
                 * `aria-current` is not a boolean that can usefully be
                 * "false": the prototype's selector is `[aria-current="true"]`,
                 * and emitting `false` on thirty-nine rows would announce each
                 * of them as a current-ness decision rather than saying
                 * nothing about them at all.
                 */
                {...(c.id === currentId ? { "aria-current": true as const } : {})}
                onClick={() => onOpen(c.id)}
              >
                <b>{c.title ?? "Untitled"}</b>
                {/* Dropped entirely rather than rendered empty — an empty
                    caption still costs its line-height, and this row's whole
                    point is that it has nothing more to say. */}
                {turns ? <span>{turns}</span> : null}
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}
