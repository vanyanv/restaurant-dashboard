"use client"

import { useEffect, useRef, useState } from "react"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"
import { applySlashCommand, matchSlashCommands } from "@/lib/chat/composer"

/**
 * `.composer` — the prototype's own bar (line 4610: the ask glyph, an input
 * whose placeholder names the range, a 28px accent send square), grown into
 * the dock the Sept-5 mock draws around it.
 *
 * ## What the mock added, and why each is here
 *
 * - **A textarea, not an input.** Enter sends, Shift-Enter breaks a line,
 *   and it grows to five lines then scrolls. A question about a week is
 *   often a sentence and a half; a single-line field hid the first half.
 * - **`/` opens the five shortcuts** from `src/lib/chat/composer.ts` — the
 *   same `/sales /spend /margin /price /forecast` the editorial chat had.
 *   Arrows and Tab move, Enter fills, Escape closes. Only while the value is
 *   an unfinished `/word`; the first space is the reader writing.
 * - **Send becomes Stop while a turn runs.** The same 28px square, the arrow
 *   crossfading into a stop mark with a ring that says something is in
 *   flight. Escape does the same from the textarea. A stopped turn is kept
 *   (see `Stopped`) — the question is never thrown away (F-R10).
 * - **The scope row** above says what the next question is asked against.
 *   Statements, not controls (D6): the date control in the head and the
 *   store switcher in the rail remain the only two places scope changes.
 * - **The hints row** below, desk only — `↵ send · ⇧↵ new line · / shortcuts
 *   · esc stop` and the model on the right. The phone has no room and no
 *   keyboard to hint about.
 *
 * `onSubmit` is called with the trimmed text and the field is cleared first,
 * so a slow send never lets the same question go twice.
 */
export function AskComposer({
  placeholder,
  onSubmit,
  busy = false,
  onStop,
  scope,
  scopeNote,
  model,
  prefill = null,
}: {
  placeholder: string
  onSubmit: (question: string) => void
  /** A turn is in flight: the send square is a stop square. */
  busy?: boolean
  onStop?: () => void
  /** The scope row: "Answering about · Store X · Range Y". */
  scope?: { store: string; range: string }
  /** The scope row's right-hand note — "Follow-ups keep this scope". */
  scopeNote?: string
  /** Names the model in the hints row; omit it and the row is not drawn. */
  model?: string
  /** Text to place in the field (not send) — a chip that wants editing first. */
  prefill?: string | null
}) {
  const [value, setValue] = useState("")
  const [cursor, setCursor] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)

  const commands = matchSlashCommands(value)
  const menuOpen = commands.length > 0

  // Grow to the text, five lines at most; the rest scrolls inside.
  const grow = () => {
    const el = ta.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(120, el.scrollHeight)}px`
  }
  useEffect(grow, [value])

  useEffect(() => {
    if (prefill === null) return
    setValue(prefill)
    ta.current?.focus()
  }, [prefill])

  const send = () => {
    const q = value.trim()
    if (!q || busy) return
    setValue("")
    onSubmit(q)
  }
  const take = (i: number) => {
    const c = commands[i]
    if (!c) return
    setValue(applySlashCommand(value, c))
    setCursor(0)
    ta.current?.focus()
  }

  return (
    <div className="dock__in">
      {scope ? (
        <div className="scoperow">
          <span>Answering about</span>
          <span className="chip">
            <span className="lbl">Store</span> {scope.store}
          </span>
          <span className="chip">
            <span className="lbl">Range</span> {scope.range}
          </span>
          {scopeNote ? <span className="sp">{scopeNote}</span> : null}
        </div>
      ) : null}


      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className={`slash${menuOpen ? " on" : ""}`} role="listbox" aria-label="Shortcuts">
          <div className="k">Shortcuts</div>
          {commands.map((c, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={i === cursor ? "on" : undefined}
              key={c.key}
              // Mouse down, not click: a click would blur the textarea first
              // and close the menu under the pointer.
              onMouseDown={(e) => {
                e.preventDefault()
                take(i)
              }}
            >
              <code>{c.key}</code>
              <b>{c.template}</b>
              <span>{c.description}</span>
            </button>
          ))}
        </div>
        <label className="csr">
          <AskGlyph />
          <textarea
            ref={ta}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab")) {
                e.preventDefault()
                const d = e.key === "ArrowUp" ? -1 : 1
                setCursor((cursor + d + commands.length) % commands.length)
                return
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if (menuOpen) take(cursor)
                else send()
                return
              }
              if (e.key === "Escape") {
                if (menuOpen) {
                  e.preventDefault()
                  setValue(value + " ")
                } else if (busy && onStop) {
                  e.preventDefault()
                  onStop()
                }
              }
            }}
            placeholder={placeholder}
            aria-label="Ask a question"
            aria-autocomplete="list"
            aria-expanded={menuOpen}
          />
        </label>
        <div className="tools">
          <button
            className={`sendbtn${busy ? " busy" : ""}`}
            type={busy ? "button" : "submit"}
            aria-label={busy ? "Stop" : "Send"}
            onClick={busy ? onStop : undefined}
          >
            <span className="ic send">
              {/* `svg('up')`, prototype line 2949, emitted as `svg()` writes it. */}
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 13V3M4 6.5L8 2.8l4 3.7" />
              </svg>
            </span>
            <span className="ic stop">
              <i />
            </span>
          </button>
        </div>
      </form>

      {model ? (
        <div className="hints">
          <span>
            <kbd>↵</kbd> send
          </span>
          <span>
            <kbd>⇧↵</kbd> new line
          </span>
          <span>
            <kbd>/</kbd> shortcuts
          </span>
          <span>
            <kbd>esc</kbd> stop
          </span>
          <span>{busy ? "reading… esc to stop" : model}</span>
        </div>
      ) : null}
    </div>
  )
}
