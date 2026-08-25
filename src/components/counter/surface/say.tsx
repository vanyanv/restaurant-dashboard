import Link from "next/link"
import type { ReactNode } from "react"
import type { Tone } from "./tone"

/**
 * `.say` — the verdict beside the lead figures.
 *
 * Emitted inline inside `headBlock()`'s argument at line 4245 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="say">
 *   <span class="state is-warn">Ahead, with one problem</span>
 *   <p>Volume is fine … <b>Food cost is 31.4% against a 30.0% plan</b>, and …</p>
 *   <button class="linkact" type="button" data-goto="cogs">Show me which items</button>
 * </div>
 * ```
 *
 * `.state` carries NO modifier when the verdict is good — `.state`'s own rule
 * is already the good wash (`counter-components.css:159`), and `is-warn` /
 * `is-bad` override it. So `tone="good"` must emit a bare `class="state"`,
 * not `class="state is-good"`, which no rule matches.
 *
 * THE PROSE IS THE ONE SENTENCE ON A COUNTER PAGE THAT CARRIES A NUMBER. It
 * names the single thing that is wrong and links to it, and `.say b` is the
 * figure that carries it. This component does NOT compose that sentence — it
 * takes it as `children`, because which figure is worth naming is a judgement
 * about the day's data, not about markup. A caller passes `<b>` where the
 * prototype does.
 *
 * `.linkact` is a `<Link>` rather than the prototype's `<button data-goto>`,
 * for the same reason `.go` and `.navbtn` are (see `Dispatch`, `Rail`): a
 * destination that is a real href is middle-clickable, and every ported
 * `.linkact` rule is class-keyed so it applies to an `<a>` unchanged. It
 * renders only when there is somewhere to go.
 *
 * `Section` is the sole state renderer (R3). `Say` takes plain data.
 */
export function Say({
  tone = "good",
  headline,
  children,
  action,
}: {
  /** `good` is the default and emits no modifier — see above. */
  tone?: Tone
  /** The verdict itself. Upper-cased by `.state`'s own `text-transform`. */
  headline: string
  /** The sentence. `<b>` around the figure that carries it. */
  children: ReactNode
  action?: { label: string; href: string }
}) {
  return (
    <div className="say">
      <span className={tone === "good" ? "state" : `state is-${tone}`}>{headline}</span>
      <p>{children}</p>
      {action ? (
        <Link className="linkact" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}
