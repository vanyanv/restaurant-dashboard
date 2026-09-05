"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { SearchGlyph } from "@/components/counter/surface/search-glyph"
import type { AskConversation } from "@/lib/counter/adapters/ask"
import { groupThreadsByDay, threadTurnLabel } from "@/lib/counter/thread-groups"
import { DotsGlyph, ForkGlyph, PenGlyph, PlusGlyph, TrashGlyph } from "./rail-glyphs"

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
 * ## What a row can do now (the Sept-5 mock)
 *
 * `docs/counter/ask-page-mock.html` gave every row a ⋯ menu — Rename, Fork
 * from the end, Delete — and the rail a footer with the count and a two-step
 * Delete all. All four verbs reach server actions that already existed or
 * wrap functions that did (`src/lib/counter/actions/conversation.ts`); what
 * was missing was a place in the rail to press. The rules the head's
 * `ThreadActions` set are kept exactly: a rename is inline (Enter saves,
 * Escape keeps the old name, so does blur), a delete arms in place ("Delete
 * for good?" · Delete / Keep) and a click anywhere else disarms it.
 *
 * The rail does not own the mutations. It reports what the reader pressed and
 * the page decides what a deleted current thread means for the URL — the
 * same split `ThreadActions` makes with `onDeleted`.
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
export interface ConversationActions {
  /** Returns an error to show on the row, or null when the rename landed. */
  onRename: (id: string, title: string) => Promise<string | null>
  /** Returns an error to show on the row, or null when the thread is gone. */
  onDelete: (id: string) => Promise<string | null>
  /** Branches through the thread's last answer and opens the branch. */
  onFork: (c: AskConversation) => void
}

export function ConversationsRail({
  query,
  onQuery,
  onNew,
  count,
  onDeleteAll,
  children,
}: {
  query: string
  onQuery: (next: string) => void
  onNew: () => void
  /**
   * How many rows the list holds — reported up by `Conversations` through
   * `onCount`, because the rail renders before the section's rows stream in
   * and the footer must not print a number it has not got. `null` hides it.
   */
  count: number | null
  /** The footer's two-step; returns an error, or null when they are all gone. */
  onDeleteAll: () => Promise<string | null>
  children: ReactNode
}) {
  const search = useRef<HTMLInputElement>(null)

  /*
   * `/` from anywhere on the page focuses the search — the mock's `<kbd>/</kbd>`
   * beside it is a promise, and this keeps it. Not while typing somewhere
   * else: a `/` in the composer opens the shortcut menu, and a `/` in a
   * rename is a character.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      e.preventDefault()
      search.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="convs">
      <div className="convs__h">
        <span>Conversations</span>
        <button type="button" onClick={onNew}>
          <PlusGlyph />
          New
        </button>
      </div>
      <label className="convs__q">
        <SearchGlyph />
        <input
          ref={search}
          type="search"
          value={query}
          placeholder="Search threads"
          aria-label="Search conversations"
          onChange={(e) => onQuery(e.target.value)}
        />
        <kbd aria-hidden="true">/</kbd>
      </label>
      <div className="convs__list">{children}</div>
      {count !== null && count > 0 ? (
        <ConversationsFoot count={count} onDeleteAll={onDeleteAll} />
      ) : null}
    </div>
  )
}

/** The rail's footer: how many, and the two-step "Delete all". */
function ConversationsFoot({
  count,
  onDeleteAll,
}: {
  count: number
  onDeleteAll: () => Promise<string | null>
}) {
  const [arming, setArming] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  // A click anywhere that is not the button itself disarms it.
  useEffect(() => {
    if (!arming) return
    const off = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-delete-all]")) return
      setArming(false)
    }
    document.addEventListener("click", off)
    return () => document.removeEventListener("click", off)
  }, [arming])

  return (
    <div className="convs__f">
      <span>{said ?? `${count} thread${count === 1 ? "" : "s"}`}</span>
      <button
        type="button"
        data-delete-all
        className={arming ? "arming" : undefined}
        onClick={() => {
          if (!arming) {
            setSaid(null)
            setArming(true)
            return
          }
          setArming(false)
          void onDeleteAll().then((err) => setSaid(err))
        }}
      >
        {arming ? `Delete all ${count} for good?` : "Delete all"}
      </button>
    </div>
  )
}

export function Conversations({
  items,
  currentId,
  today,
  onOpen,
  actions,
  onCount,
}: {
  items: AskConversation[]
  currentId: string | null
  /** The page's resolved `today` — "Today" decided once, on the server. */
  today: Date
  onOpen: (id: string) => void
  actions: ConversationActions
  /** Tells the rail how many rows it is holding, for the footer. */
  onCount?: (n: number) => void
}) {
  useEffect(() => {
    onCount?.(items.length)
  }, [items.length, onCount])

  // One menu open at a time, across every group.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  useEffect(() => {
    if (!menuFor) return
    const off = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-cv-menu]")) return
      setMenuFor(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null)
    }
    document.addEventListener("click", off)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("click", off)
      document.removeEventListener("keydown", esc)
    }
  }, [menuFor])

  return (
    <>
      {groupThreadsByDay(items, today).map((group) => (
        <div key={group.label}>
          <div className="cvgrp">{group.label}</div>
          {group.items.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              current={c.id === currentId}
              menuOpen={menuFor === c.id}
              onMenu={(open) => setMenuFor(open ? c.id : null)}
              onOpen={() => onOpen(c.id)}
              actions={actions}
            />
          ))}
        </div>
      ))}
    </>
  )
}

function ConversationRow({
  c,
  current,
  menuOpen,
  onMenu,
  onOpen,
  actions,
}: {
  c: AskConversation
  current: boolean
  menuOpen: boolean
  onMenu: (open: boolean) => void
  onOpen: () => void
  actions: ConversationActions
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState("")
  const [arming, setArming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const meta = threadTurnLabel(c.turns)

  const startRename = () => {
    onMenu(false)
    setArming(false)
    setDraft(c.title ?? "")
    setRenaming(true)
  }
  const finishRename = (save: boolean) => {
    setRenaming(false)
    const next = draft.trim()
    if (!save || !next || next === c.title) return
    void actions.onRename(c.id, next).then((err) => setSaid(err))
  }
  const arm = () => {
    onMenu(false)
    setRenaming(false)
    setSaid(null)
    setArming(true)
  }
  const remove = () => {
    setArming(false)
    setLeaving(true)
    // 180ms is the row's own `.leaving` transition; the request runs
    // underneath it and the row is gone from the list when it lands.
    void actions.onDelete(c.id).then((err) => {
      if (err) {
        setLeaving(false)
        setSaid(err)
      }
    })
  }

  // The "row" is a div, not a button, once it holds a menu and an input of
  // its own: a button cannot contain them. It keeps the button's behaviour —
  // Enter/Space open, `r` renames, Delete/Backspace arm — via the handlers.
  const cls = [
    "cv",
    arming ? "arming" : "",
    leaving ? "leaving" : "",
    menuOpen ? "menu-open" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="swipe" data-id={c.id}>
      <div
        className={cls}
        role="button"
        tabIndex={0}
        {...(current ? { "aria-current": true as const } : {})}
        onClick={(e) => {
          if (arming || renaming) return
          if ((e.target as HTMLElement).closest("[data-cv-menu]")) return
          onOpen()
        }}
        onKeyDown={(e) => {
          if (renaming || (e.target as HTMLElement).tagName === "INPUT") return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            if (!arming) onOpen()
          } else if (e.key === "r" || e.key === "R") {
            e.preventDefault()
            startRename()
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault()
            arm()
          }
        }}
      >
        <span className="tx">
          {renaming ? (
            <input
              className="rn"
              type="text"
              value={draft}
              autoFocus
              maxLength={80}
              aria-label="Name this conversation"
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => finishRename(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  finishRename(true)
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  finishRename(false)
                }
              }}
            />
          ) : (
            <b>{c.title ?? "Untitled"}</b>
          )}
          {said ? (
            <span className="m is-said">{said}</span>
          ) : meta ? (
            <span className="m">{meta}</span>
          ) : null}
        </span>
        {!renaming && !arming ? (
          <span
            className="kebab"
            role="button"
            tabIndex={-1}
            aria-label="Thread actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-cv-menu
            onClick={(e) => {
              e.stopPropagation()
              onMenu(!menuOpen)
            }}
          >
            <DotsGlyph />
          </span>
        ) : null}
        {arming ? (
          <span className="arm">
            Delete for good?
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                remove()
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="keep"
              onClick={(e) => {
                e.stopPropagation()
                setArming(false)
              }}
            >
              Keep
            </button>
          </span>
        ) : null}
      </div>
      <div className={`cvmenu${menuOpen ? " on" : ""}`} role="menu" data-cv-menu>
        <button type="button" role="menuitem" onClick={startRename}>
          <PenGlyph />
          Rename
          <span className="kbd">R</span>
        </button>
        {c.lastAnswerId ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onMenu(false)
              actions.onFork(c)
            }}
          >
            <ForkGlyph />
            Fork from the end
          </button>
        ) : null}
        <button type="button" role="menuitem" className="danger" onClick={arm}>
          <TrashGlyph />
          Delete
          <span className="kbd">⌫</span>
        </button>
      </div>
    </div>
  )
}
