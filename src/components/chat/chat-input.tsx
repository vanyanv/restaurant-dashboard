"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"
import {
  applySlashCommand,
  formatScopeLabel,
  matchSlashCommands,
  type ComposerScope,
} from "@/lib/chat/composer"

interface Props {
  onSubmit: (text: string) => void
  disabled?: boolean
  isStreaming?: boolean
  /** Surfaced from useChat when the route returns an error. */
  error?: string | null
  /** When the parent wants to seed the input (e.g. clicked a suggestion). */
  initialText?: string
  metaHint?: string
  /** Stores the owner runs. Absent on surfaces that don't load them. */
  stores?: Array<{ id: string; name: string }>
  scope?: ComposerScope
  onScopeChange?: (next: ComposerScope) => void
}

const BARE_SCOPE: ComposerScope = { storeName: null, from: null, to: null }

/** Composer in the search-shell register. Single textarea that auto-grows
 * up to 7em, Enter submits (Shift+Enter inserts a newline), trailing
 * meta row shows the kbd hint at rest and a live-dot when streaming.
 *
 * Two affordances sit above the textarea: scope chips, which attach a store
 * and a date range to the question so the model doesn't spend a round trip
 * resolving them, and a slash menu that names the questions the tool layer
 * answers well. */
export function ChatInput({
  onSubmit,
  disabled,
  isStreaming,
  error,
  initialText,
  metaHint = "⌘K to toggle · Esc to close · Shift+Enter for newline",
  stores,
  scope = BARE_SCOPE,
  onScopeChange,
}: Props) {
  const [value, setValue] = useState("")
  const [slashIdx, setSlashIdx] = useState(0)
  const [storeOpen, setStoreOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !disabled

  const slashHits = useMemo(() => matchSlashCommands(value), [value])
  const slashOpen = slashHits.length > 0

  useEffect(() => {
    setSlashIdx(0)
  }, [value])

  useEffect(() => {
    if (initialText) {
      setValue(initialText)
      ref.current?.focus()
    }
  }, [initialText])

  // Auto-grow height up to the css `max-height: 7em`.
  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${ta.scrollHeight}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
    setValue("")
  }

  const takeSlash = (i: number) => {
    const cmd = slashHits[i]
    if (!cmd) return
    setValue(applySlashCommand(value, cmd))
    ref.current?.focus()
  }

  const scopeLabel = formatScopeLabel(scope)

  return (
    <div className="chat-input-shell">
      {onScopeChange && (
        <div className="chat-scope">
          <span className="chat-scope__lead">Asking about</span>

          {stores && stores.length > 0 && (
          <div className="chat-scope__picker">
            <button
              type="button"
              className={"chat-scope__chip" + (scope.storeName ? " is-set" : "")}
              onClick={() => setStoreOpen((o) => !o)}
              aria-expanded={storeOpen}
            >
              {scope.storeName ?? "All stores"} <span aria-hidden>▾</span>
            </button>
            {storeOpen && (
              <div className="chat-scope__menu">
                <button
                  type="button"
                  className="chat-scope__opt"
                  onClick={() => {
                    onScopeChange({ ...scope, storeName: null })
                    setStoreOpen(false)
                  }}
                >
                  All stores
                </button>
                {(stores ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="chat-scope__opt"
                    onClick={() => {
                      onScopeChange({ ...scope, storeName: s.name })
                      setStoreOpen(false)
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          <label className="chat-scope__chip chat-scope__chip--date">
            <span className="sr-only">From</span>
            <input
              type="date"
              value={scope.from ?? ""}
              onChange={(e) =>
                onScopeChange({ ...scope, from: e.target.value || null })
              }
            />
          </label>
          <span className="chat-scope__dash" aria-hidden>
            –
          </span>
          <label className="chat-scope__chip chat-scope__chip--date">
            <span className="sr-only">To</span>
            <input
              type="date"
              value={scope.to ?? ""}
              onChange={(e) =>
                onScopeChange({ ...scope, to: e.target.value || null })
              }
            />
          </label>

          {scopeLabel && (
            <button
              type="button"
              className="chat-scope__clear"
              onClick={() => onScopeChange(BARE_SCOPE)}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="chat-input-wrap">
        {slashOpen && (
          <div className="chat-slash" role="listbox" aria-label="Shortcuts">
            {slashHits.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="option"
                aria-selected={i === slashIdx}
                className={"chat-slash__item" + (i === slashIdx ? " is-sel" : "")}
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => takeSlash(i)}
              >
                <span className="chat-slash__key">{c.key}</span>
                <span className="chat-slash__desc">{c.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            ref={ref}
            className="chat-input"
            rows={1}
            value={value}
            placeholder={
              isStreaming
                ? "Answering…"
                : "Ask about sales, costs, invoices, or menu prices.  Type / for shortcuts."
            }
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setSlashIdx((i) => (i + 1) % slashHits.length)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setSlashIdx((i) => (i - 1 + slashHits.length) % slashHits.length)
                  return
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault()
                  takeSlash(slashIdx)
                  return
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
                return
              }
              // Escape: clear text first, then let the document-level handler
              // close the drawer on a second press. Standard command-palette
              // pattern so an accidental keystroke doesn't blow away a draft.
              if (e.key === "Escape" && value.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                setValue("")
              }
            }}
            disabled={disabled}
            aria-label="Chat input"
          />
          {isStreaming ? (
            <span className="live-dot" aria-label="streaming" title="streaming" />
          ) : (
            <button
              type="button"
              className="chat-input-send"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
            >
              <SendHorizontal aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="chat-input-meta">
        <span className="chat-input-meta__hint">{metaHint}</span>
        {error && <span className="chat-input-meta__error">{error}</span>}
      </div>
    </div>
  )
}
