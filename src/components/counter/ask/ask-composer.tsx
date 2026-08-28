"use client"

import { useState } from "react"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"

/**
 * `.composer` — the box you type the next question into, from `P.ask.composer`
 * at line 4600 of `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="composer">
 *   <label class="csr">{ask glyph}<input placeholder="Ask a follow-up about this range…"></label>
 *   <button class="sendbtn" aria-label="Send">{up glyph}</button>
 * </div>
 * ```
 *
 * Three classes with rules in the ported sheet — `.composer` (455–459,
 * 1277–1286), `.csr`, `.sendbtn` — and no emitter anywhere in this tree until
 * now. This file writes no CSS.
 *
 * A `<form>` rather than the prototype's `<div>`: `.composer` is a class
 * selector and does not care, and a form is what makes Enter send without a
 * keydown handler of this component's own, and what gives the button its
 * `type="submit"` meaning to a screen reader.
 *
 * IT HOLDS ITS OWN TEXT, AND NOTHING ELSE. The question that has been ASKED
 * lives in the URL (`?q=`), which is what makes an answer a link someone can
 * send; what is half-typed in here is not a question yet and has no business
 * in the address bar. On submit the field clears — the question it held is now
 * on screen above it.
 */
export function AskComposer({
  placeholder,
  onSubmit,
  disabled = false,
}: {
  placeholder: string
  onSubmit: (question: string) => void
  /** A question is already in flight; the send button is not a second one. */
  disabled?: boolean
}) {
  const [value, setValue] = useState("")

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        const q = value.trim()
        if (!q) return
        setValue("")
        onSubmit(q)
      }}
    >
      <label className="csr">
        <AskGlyph />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label="Ask a question"
        />
      </label>
      <button className="sendbtn" type="submit" aria-label="Send" disabled={disabled}>
        {/* `svg('up')`, prototype line 2949, emitted as `svg()` writes it.
            `.sendbtn svg` sizes it, so it carries no dimensions of its own. */}
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
      </button>
    </form>
  )
}
