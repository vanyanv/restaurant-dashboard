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
 *    document listener and opens in place. The phone composes no `AppShell`,
 *    so there is no surface listening — a `data-askabout` here would be note
 *    46's defect exactly: a shortcut printed on a surface that opens nothing.
 *    The prototype's own `data-goto="ask"` navigates too, so this is the
 *    prototype's behaviour reached through a real router.
 *
 * A suggestion therefore opens the Ask page rather than pre-filling it: `/m/chat`
 * takes no question parameter, and inventing one that its client ignores would
 * be the same defect one layer down. The prototype's suggestions do not
 * pre-fill either.
 *
 * `Section` is the sole state renderer (R3). The prototype prints this sheet
 * in every state including `empty` — a store that is not trading is still a
 * store you can ask about — so it takes plain props and no status.
 */
export function AskSheet({
  prompt,
  href,
  suggestions = [],
}: {
  /** `.ph` — "Ask about today", "Ask about this range". */
  prompt: string
  /** The Ask page this surface's questions open. */
  href: string
  /** The chips. Omit them and no `.sugs` is drawn. */
  suggestions?: string[]
}) {
  return (
    <div className="masksheet">
      <Link className="row" href={href}>
        <AskGlyph />
        <span className="ph">{prompt}</span>
      </Link>
      {suggestions.length > 0 ? (
        <div className="sugs">
          {suggestions.map((q) => (
            <Link key={q} className="sug" href={href}>
              {q}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
