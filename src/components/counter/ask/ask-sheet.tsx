import Link from "next/link"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"

/**
 * `.masksheet` — the phone's way into Ask.
 *
 * Emitted inline inside `P.overview.phone()` at line 4375 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="masksheet">
 *   <button class="row" type="button" data-goto="ask">
 *     …ask glyph…<span class="ph">Ask about today</span>
 *   </button>
 *   <div class="sugs">
 *     <button class="sug" type="button" data-goto="ask">Why is food cost over?</button>
 *     <button class="sug" type="button" data-goto="ask">Prep for Saturday?</button>
 *   </div>
 * </div>
 * ```
 *
 * ## This is not `AskBar` with a different class
 *
 * Three differences, all of them the prototype's, and together they are why
 * the two are separate components rather than one with a `variant` prop:
 *
 * 1. **No `<kbd>⌘K</kbd>`.** A phone has no command key. `.askbar__in kbd` is
 *    styled; `.masksheet .row` has no kbd rule at all.
 * 2. **No `.sk` on the first suggestion.** The desk labels the row SUGGESTED
 *    once; the phone has room for two chips and no room for a label.
 * 3. **Every control NAVIGATES.** `AskBar` carries `data-askabout`, which the
 *    one `AskSurface` mounted in `AppShell` picks up through its delegated
 *    document listener and answers IN PLACE, over the page. The phone composes
 *    no `AppShell` and no palette: `PhoneShell` catches the same attribute and
 *    pushes `/m/ask?q=…` instead, because a 316px column has no room to open a
 *    surface over itself. So these are `<Link>`s outright — an anchor gets the
 *    address bar, long-press-to-copy and "open in new tab" for free, and it is
 *    the destination the delegation would have computed anyway.
 *    The prototype's own `data-goto="ask"` navigates too, so this is the
 *    prototype's behaviour reached through a real router.
 *
 * A suggestion therefore ASKS by navigating: `/m/ask?q=…` reads its question
 * off the URL, so the chip that says "Why is food cost where it is?" lands on
 * that question being answered, not on an empty box with the question typed
 * into it. Each chip carries its own href for that reason — the caller builds
 * them with `askHref`, the same builder the desk's "Open in Ask" uses, so the
 * store and the window travel with the question.
 *
 * This used to point at `/m/chat` with two chips that all opened the same
 * empty editorial thread, which was note 46's defect at one remove: three
 * controls, one destination, and none of them carrying what it said.
 *
 * `Section` is the sole state renderer (R3). The prototype prints this sheet
 * in every state including `empty` — a store that is not trading is still a
 * store you can ask about — so it takes plain props and no status.
 */
/** A chip: the question, and the address that answers it. */
export interface AskSuggestion {
  question: string
  href: string
}

export function AskSheet({
  prompt,
  href,
  suggestions = [],
}: {
  /** `.ph` — "Ask about today", "Ask about this range". */
  prompt: string
  /** Ask with nothing asked yet — the row opens the page's own empty state. */
  href: string
  /** The chips, each with the address that answers it. Omit them and no `.sugs` is drawn. */
  suggestions?: readonly AskSuggestion[]
}) {
  return (
    <div className="masksheet">
      <Link className="row" href={href}>
        <AskGlyph />
        <span className="ph">{prompt}</span>
      </Link>
      {suggestions.length > 0 ? (
        <div className="sugs">
          {suggestions.map((s) => (
            <Link key={s.question} className="sug" href={s.href}>
              {s.question}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
