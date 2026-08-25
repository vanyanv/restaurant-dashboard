"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { describeAskContext, type AskContext } from "@/lib/counter/ask-context"

/**
 * The ⌘K palette. Note 46: two surfaces printed the shortcut and neither
 * opened anything — the palette itself was fully designed (input, group
 * headings, selected row, footer hints) and mounted nowhere. This is that
 * palette, mounted once in `AppShell` (see task 3) so every Counter page
 * gets it without opting in.
 *
 * The context sentence above the input is `describeAskContext`'s output —
 * derived from the same `pathname`/`params` the page itself reads, never a
 * prop a caller could let go stale (note 43).
 *
 * `[data-askabout]` reaches this surface by EVENT DELEGATION: one `click`
 * listener on `document` walks up from the click target. `Section` — the
 * sole renderer of `SectionData`'s six states — stays a server component
 * because of this; an `onAsk` prop on `Section` would force it client-side
 * and drag every page's data rendering along with it (note 55).
 */
export function AskSurface({
  pathname,
  params,
  storeName,
  today,
  onSubmit,
}: {
  pathname: string
  params: URLSearchParams
  storeName: string | null
  today: Date
  onSubmit?: (question: string, context: AskContext) => void
}) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  // The element focused before ⌘K (or an "Ask about this" click) opened the
  // surface — a reader who summoned this mid-page should land back exactly
  // where they were, not at document.body.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const context = describeAskContext({ pathname, params, storeName, today })

  function openSurface(prefill: string) {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    setQuestion(prefill)
    setOpen(true)
  }

  // ⌘K / Ctrl+K opens the surface, from anywhere. Delegated `[data-askabout]`
  // clicks open it pre-filled. Both listeners are mounted once, for the life
  // of the component — a reader can summon the surface whether or not it is
  // already open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        openSurface("")
      }
    }
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      const askEl = target?.closest("[data-askabout]")
      if (askEl) openSurface(askEl.getAttribute("data-askabout") ?? "")
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("click", onClick)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("click", onClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes and restores focus — only wired while open, same pattern
  // as DateControl's and StoreSwitcher's own popovers.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false)
        restoreFocusRef.current?.focus?.()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  function close() {
    setOpen(false)
    restoreFocusRef.current?.focus?.()
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit?.(question, context)
    close()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ct-ink/40 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask a question"
        className="w-full max-w-[560px] rounded-ct border border-ct-line-strong bg-ct-surface p-5"
      >
        <p className="mb-3 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          {context.sentence}
        </p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            aria-label="Ask a question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this page…"
            className="w-full rounded-ct-sm border border-ct-line bg-ct-paper px-3 py-2 text-ct-body text-ct-ink outline-none focus:border-ct-line-strong"
          />
        </form>

        <p className="mt-3 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  )
}
