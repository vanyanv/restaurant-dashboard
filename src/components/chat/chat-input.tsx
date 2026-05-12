"use client"

import { useEffect, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"

interface Props {
  onSubmit: (text: string) => void
  disabled?: boolean
  isStreaming?: boolean
  /** Surfaced from useChat when the route returns an error. */
  error?: string | null
  /** When the parent wants to seed the input (e.g. clicked a suggestion). */
  initialText?: string
  metaHint?: string
}

/** Composer in the search-shell register. Single textarea that auto-grows
 * up to 7em, Enter submits (Shift+Enter inserts a newline), trailing
 * meta row shows the kbd hint at rest and a live-dot when streaming. */
export function ChatInput({
  onSubmit,
  disabled,
  isStreaming,
  error,
  initialText,
  metaHint = "⌘K to toggle · Esc to close · Shift+Enter for newline",
}: Props) {
  const [value, setValue] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !disabled

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

  return (
    <div className="chat-input-shell">
      <div className="chat-input-row">
        <textarea
          ref={ref}
          className="chat-input"
          rows={1}
          value={value}
          placeholder={
            isStreaming
              ? "Answering…"
              : "Ask about sales, costs, invoices, or menu prices."
          }
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
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
      <div className="chat-input-meta">
        <span className="chat-input-meta__hint">{metaHint}</span>
        {error && <span className="chat-input-meta__error">{error}</span>}
      </div>
    </div>
  )
}
