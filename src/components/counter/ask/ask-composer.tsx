"use client"

import { useEffect, useRef, useState } from "react"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"
import { applySlashCommand, matchSlashCommands } from "@/lib/chat/composer"
import { ASK_EFFORTS, type AskEffort } from "@/lib/counter/ask-context"

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
 * - **One row** ("Ask in Motion II", 2026-09-07). The scope row that used to
 *   sit above is gone: the page head and the placeholder name the scope, and
 *   the answer's own `.scoperow--was` says when a turn was computed under a
 *   different one. The store switcher in the rail is where scope changes.
 * - **Quick / Careful** in the tools slot, where the model tag used to be
 *   printed. "gpt-5-mini · low" meant nothing to an owner; a choice with a
 *   cost in seconds does. Careful lifts the reasoning effort for the next
 *   turn (`reasoningEffortFor` in the route). Drawn only when the page owns
 *   the choice (`effort` + `onEffort`); the palette and the phone pass none.
 * - **The hints row** below appears on focus (`.dock__in:focus-within`) and
 *   whenever it has something to say that is not a shortcut — the mic's
 *   transcript, a running turn. `↵ send · ⇧↵ new line · / shortcuts · esc
 *   stop`, and the effort's cost on the right.
 *
 * `onSubmit` is called with the trimmed text and the field is cleared first,
 * so a slow send never lets the same question go twice.
 */
export function AskComposer({
  placeholder,
  onSubmit,
  busy = false,
  onStop,
  effort = null,
  onEffort,
  prefill = null,
  mic = false,
}: {
  placeholder: string
  onSubmit: (question: string) => void
  /** A turn is in flight: the send square is a stop square. */
  busy?: boolean
  onStop?: () => void
  /**
   * The Quick / Careful choice beside the field, or `null` to draw no toggle
   * (the palette). Careful lifts the model's reasoning effort for the next
   * turn — `reasoningEffortFor` in the route. Owned by the page so the choice
   * outlives a send.
   */
  effort?: AskEffort | null
  onEffort?: (next: AskEffort) => void
  /** Text to place in the field (not send) — a chip that wants editing first. */
  prefill?: string | null
  /**
   * Hold-to-speak. Records with `MediaRecorder`, posts to
   * `/api/ask/transcribe`, and puts the words in the field — never sends
   * them. Off by default; the surfaces that show it opt in.
   */
  mic?: boolean
}) {
  const [value, setValue] = useState("")
  const [cursor, setCursor] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)

  /*
   * THE MIC. Pointer down starts a recording and lights the ring; pointer up
   * stops it and sends the blob to be transcribed. Under 400ms is a tap, not
   * a hold, and gets the hint instead of a request. The transcript lands in
   * the field for the reader to check — a mis-heard word should not become a
   * question. Nothing here runs unless `mic` is on and the browser has a
   * recorder; where it does not, the button is not drawn.
   */
  const [listening, setListening] = useState(false)
  const [micSaid, setMicSaid] = useState<string | null>(null)
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; started: number } | null>(null)
  // Decided after mount, not during render: the server has no recorder and
  // must not draw a different composer from the one the browser hydrates.
  const [canRecord, setCanRecord] = useState(false)
  useEffect(() => {
    setCanRecord(mic && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices)
  }, [mic])
  const micDown = async () => {
    if (rec.current || busy) return
    setMicSaid(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      rec.current = { recorder, chunks, started: Date.now() }
      recorder.start()
      setListening(true)
    } catch {
      setMicSaid("Microphone is off in this browser")
    }
  }
  const micUp = () => {
    const r = rec.current
    if (!r) return
    rec.current = null
    setListening(false)
    const seconds = (Date.now() - r.started) / 1000
    r.recorder.onstop = () => {
      r.recorder.stream.getTracks().forEach((t) => t.stop())
      if (seconds < 0.4) {
        setMicSaid("Hold to speak")
        return
      }
      const blob = new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" })
      const form = new FormData()
      form.append("audio", blob, "question.webm")
      form.append("seconds", seconds.toFixed(1))
      setMicSaid("Transcribing…")
      void fetch("/api/ask/transcribe", { method: "POST", body: form })
        .then(async (res) => {
          const data = (await res.json()) as { text?: string; error?: string }
          if (!res.ok || !data.text) {
            setMicSaid(data.error ?? "The recording could not be transcribed")
            return
          }
          setValue((v) => (v.trim() ? `${v.trim()} ${data.text}` : data.text!))
          setMicSaid("Transcribed · ↵ to send")
          ta.current?.focus()
        })
        .catch(() => setMicSaid("The recording could not be transcribed"))
    }
    r.recorder.stop()
  }

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
          {effort !== null && onEffort ? (
            <div className="effort" role="group" aria-label="How hard to think">
              {ASK_EFFORTS.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  aria-pressed={effort === e.id}
                  onClick={() => onEffort(e.id)}
                >
                  {e.label}
                </button>
              ))}
            </div>
          ) : null}
          {canRecord ? (
            <button
              type="button"
              className={`ibtn mic${listening ? " on" : ""}`}
              aria-label={listening ? "Listening — release to send" : "Hold to speak"}
              aria-pressed={listening}
              onPointerDown={(e) => {
                e.preventDefault()
                void micDown()
              }}
              onPointerUp={micUp}
              onPointerLeave={micUp}
              onPointerCancel={micUp}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
                <path d="M3 7.5a5 5 0 0010 0M8 12.5v2" />
              </svg>
            </button>
          ) : null}
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

      {/*
        * THE HINTS ROW SHOWS ON FOCUS (`.dock__in:focus-within .hints`), and
        * whenever it has something to say that is not a shortcut — the mic's
        * transcript, a running turn. At rest the dock is one row; the keys
        * appear the moment the field has focus, which is when a reader
        * reaches for them. The right-hand slot names the effort chosen and
        * what it costs in seconds, in place of the model tag it used to print
        * ("gpt-5-mini · low" meant nothing to an owner).
        */}
      <div className={`hints${micSaid || busy ? " on" : ""}`} aria-live="polite">
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
        <span>
          {micSaid ??
            (busy ? "reading… esc to stop" : (ASK_EFFORTS.find((e) => e.id === effort)?.hint ?? ""))}
        </span>
      </div>
    </div>
  )
}
