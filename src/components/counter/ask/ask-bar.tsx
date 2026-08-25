import { AskGlyph } from "@/components/counter/surface/ask-glyph"

/**
 * `.askbar` — the way into Ask that sits on the page rather than behind a
 * keystroke nobody was told about.
 *
 * Emitted inline inside `P.overview.desk()` at line 4302 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="askbar">
 *   <button class="askbar__in" type="button" data-cmdopen>
 *     <svg …ask glyph…><span class="ph">Ask anything about Hollywood, today or any range…</span><kbd>⌘K</kbd>
 *   </button>
 *   <div class="sugs">
 *     <button class="sug" type="button" data-goto="ask"><span class="sk">Suggested</span> Why is food cost 2.4 points over plan?</button>
 *     <button class="sug" type="button" data-goto="ask">What should I prep for Saturday?</button>
 *     <button class="sug" type="button" data-goto="ask">Did the ground beef price stick?</button>
 *   </div>
 * </div>
 * ```
 *
 * ONLY THE FIRST SUGGESTION CARRIES `.sk`. It labels the row, not the chip —
 * three chips each stamped SUGGESTED is the word three times and the questions
 * once.
 *
 * THIS IS NOT A SECOND ASK SURFACE. `AskSurface` (⌘K) is mounted once in
 * `AppShell`, and it already listens on `document` for a click inside any
 * `[data-askabout]` element — the same delegation `Section`'s `.askmini` uses
 * (note 55). So:
 *
 *   - `.askbar__in` carries `data-askabout=""` — an empty question opens the
 *     surface with an empty input, which is exactly what the prototype's
 *     `data-cmdopen` does.
 *   - each `.sug` carries `data-askabout={question}`, which opens the SAME
 *     surface pre-filled with that question.
 *
 * That means this component has no handler, no state and no `"use client"`:
 * every click is handled by the one surface that already exists. Two
 * divergences from the prototype's attributes, both deliberate and both the
 * existing convention rather than a new path:
 *
 *   - `data-cmdopen` is dropped. Nothing in this app listens for it and no
 *     ported rule styles it; emitting it would be markup that looks wired and
 *     is not, which is note 46's defect (a shortcut printed on two surfaces
 *     that opened nothing).
 *   - `data-goto="ask"` is dropped. The prototype's suggestion NAVIGATES to a
 *     full Ask page; ours pre-fills the surface in place, which is what the
 *     task brief specifies and what `AskSurface`'s existing API offers. A
 *     Phase C decision could add a real href to the full Ask page alongside
 *     it; it is not this component's to invent.
 *
 * `Section` is the sole state renderer (R3). The prototype prints the ask bar
 * in every state including `empty` — a store that is not trading is still a
 * store you can ask about — so this takes plain props and no status.
 */
export function AskBar({
  placeholder,
  suggestions = [],
}: {
  /** `.ph` — the prototype names the store and the range: "Ask anything about Hollywood, today or any range…". */
  placeholder: string
  /** The chips. The first is labelled SUGGESTED; omit them and no `.sugs` is drawn. */
  suggestions?: string[]
}) {
  return (
    <div className="askbar">
      <button type="button" className="askbar__in" data-askabout="">
        <AskGlyph />
        <span className="ph">{placeholder}</span>
        <kbd>⌘K</kbd>
      </button>
      {suggestions.length > 0 ? (
        <div className="sugs">
          {suggestions.map((q, i) => (
            <button key={q} type="button" className="sug" data-askabout={q}>
              {i === 0 ? <span className="sk">Suggested</span> : null}
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
