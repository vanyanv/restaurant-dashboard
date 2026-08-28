"use client"

import Link from "next/link"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"
import { Strip } from "@/components/counter/surface/strip"
import { MStrip } from "@/components/counter/shell/m-strip"
import type { FigureProps } from "@/components/counter/surface/figure"
import { labelFor } from "@/components/chat/tool-labels"
import type { AskContext } from "@/lib/counter/ask-context"
import { askAnswer, askFailure, askQuestion, type AskState } from "@/lib/counter/use-ask"

/**
 * The answer that fills `.cmdk__pane[data-cmdans]` — `askRender()` at line
 * 8611 of `docs/counter/counter-prototype.html`, in the prototype's order and
 * the prototype's classes:
 *
 * ```
 * .askans
 *   .askans__q      {ask glyph}<span>the question as typed</span>
 *   .askans__body
 *     p.ans__lead   the verdict
 *     .strip        the figures                     ← see FIGURES, below
 *     p.callout     the caveat — a refusal, or a transport failure
 *     .srcs         <span class="src">Read</span> + one chip per tool
 *     .sugs         the model's own follow-ups, each a `.sug[data-askabout]`
 *   .askans__foot   store · range · Back to search · Open in Ask
 * ```
 *
 * This file writes no CSS. Every class above is already in the ported sheet
 * (`.askans*` at counter-components.css:1253–1262, `.ans__lead`/`.srcs`/`.src`
 * at 450–454, `.callout` at 625, `.sugs`/`.sug` at 374–377, `.btnrow`/`.btn`
 * at 324–334) and had nothing rendering it until now.
 *
 * ---------------------------------------------------------------------------
 * FIGURES ARE A `Strip`, NOT `.askans__fig`
 * ---------------------------------------------------------------------------
 *
 * The one deliberate divergence from `askRender()`. The prototype's figure
 * block is a `.askans__fig` box holding whatever that invented answer felt
 * like — a `kv()` list, a `askBars()` rank. A real `ReturnFigure` is
 * `{value, label, delta, direction}`, which is precisely `FigureProps`, and
 * `Strip`/`Figure` is this application's ONLY renderer of that quartet. Using
 * it means a figure in an answer is the same object, in the same tabular
 * numerals, with the same `.d.is-down` tone, as the figure on the page the
 * question was asked from — which is the entire argument for having a design
 * system. `.askans__fig` would have wrapped it in a second border and a
 * second background, and `.kv` cannot express a delta at all without new CSS.
 *
 * `direction` is the model's JUDGEMENT, not the arithmetic sign — more produce
 * spend arrives as "down". No direction at all means the model did not judge
 * it, so the delta is `is-flat` rather than inheriting `.d`'s default
 * `var(--good)`: an unjudged number tinted green is a claim nobody made.
 *
 * ---------------------------------------------------------------------------
 * NO "GO TO" BUTTON ROW
 * ---------------------------------------------------------------------------
 *
 * `askRender()` emits a `.btnrow` of destinations from the invented answer's
 * own `go` list. Nothing in `FiledReturn` carries destinations, and a row of
 * pages guessed from a department name is a row of links that may not hold the
 * answer — note 46's defect wearing a different hat. The foot's "Open in Ask"
 * is the one destination an answer genuinely has, and the model's own
 * `followUps` are what it offers instead of a guess.
 *
 * ---------------------------------------------------------------------------
 * A REFUSAL IS AN ANSWER (K-R3)
 * ---------------------------------------------------------------------------
 *
 * `returnForm` returns "empty" when the model filed `NO_DATA_DEPARTMENT`. That
 * turn renders NO figure strip — there is nothing to show — and puts the
 * model's own paragraph in `.callout`, which is the sheet's "read this part"
 * band. The refusal keeps its "Read" row and its follow-ups, because naming
 * what it looked at IS the reason to believe it when it says the answer is not
 * there.
 */
/**
 * The answer ITSELF — everything between the question and whatever chrome the
 * surface wraps it in. Split out of `AskAnswerPane` for `/dashboard/ask`,
 * which prints the same answer inside `.ans` on a page instead of inside
 * `.askans__body` in a palette.
 *
 * It is one component and not two because a second renderer is how two
 * surfaces come to disagree about what an answer looks like — the palette and
 * the page must show one figure strip, one "Read" row and one refusal, or the
 * link someone sends is not the answer they saw. Only three things differ, and
 * all three are props:
 *
 *   - `className`, the wrapper the sheet styles (`.askans__body` / `.ans`).
 *   - `verdictShownAbove`, because the page's HEADLINE is the verdict
 *     (prototype 4507: "the headline is the answer, so it cannot be there
 *     before the answer is") and printing it again as the first paragraph
 *     would be the same sentence twice, three lines apart.
 *   - `onFollowUp`. In the palette a follow-up chip carries `data-askabout`
 *     and is caught by the one document-level delegation `AskSurface` mounts.
 *     On the page that delegation would open the PALETTE over the page and
 *     answer there — so the page passes a handler instead, and the chip stops
 *     carrying the attribute. Exactly one path fires either way.
 *   - `figures`, which strip draws the quartet. `.strip` is a six-track grid
 *     whose track count is `data-n`; at the phone's 316px those tracks are
 *     ~50px wide and the figures overflow the column. `.mstrip` is the same
 *     four fields in the phone's own two-column grid, and it is what every
 *     other figure on a `/m` page is already drawn with — the third surface
 *     changes the strip, not the answer.
 *
 * A fourth prop, and NOT a fourth renderer: what an answer IS — the verdict,
 * the figures, the caveat, the "Read" row, the follow-ups, and the order they
 * come in — is decided once, here, for all three.
 */
export function AskAnswerBody({
  state,
  className = "askans__body",
  verdictShownAbove = false,
  onFollowUp,
  figures = "strip",
}: {
  state: AskState
  className?: string
  /** The verdict is the page's `<h2>`; do not print it here as well. */
  verdictShownAbove?: boolean
  /** Present on a surface that answers a follow-up itself; absent in the palette. */
  onFollowUp?: (question: string) => void
  /** `.strip` on the desk's two surfaces, `.mstrip` on the phone. */
  figures?: "strip" | "mstrip"
}) {
  const { status } = state
  const answer = askAnswer(state)
  const failure = askFailure(state)

  const filed = answer?.filed ?? null
  const empty = answer?.form === "empty"
  const filedFigures = empty ? [] : (filed?.figures ?? [])
  const cells: FigureProps[] = filedFigures.map((f) => ({
    label: f.label,
    value: f.value,
    ...(f.delta
      ? { delta: f.delta, ...(f.direction === "up" ? {} : { deltaTone: f.direction === "down" ? ("is-down" as const) : ("is-flat" as const) }) }
      : {}),
  }))

  // The model's own paragraph, kept apart from its verdict — the only text
  // that can appear twice if the two are not kept straight.
  const prose = filed && answer?.body ? answer.body : ""
  const verdictAbove = verdictShownAbove && Boolean(filed?.verdict)

  // The lead is the verdict when the model filed one. A turn that answered in
  // prose without filing still has something to say, so its paragraph leads
  // instead of leaving an empty first line above the sources. With the verdict
  // already in the headline the prose leads instead — and on a REFUSAL the
  // prose is the callout below, so the lead is empty rather than doubled.
  const lead = verdictAbove ? (empty ? "" : prose) : (filed?.verdict ?? answer?.body ?? "")
  // …and is then not repeated underneath itself.
  const note = verdictAbove ? "" : prose
  const caveat = failure ?? (empty ? prose : "")

  return (
    <div className={className} aria-live="polite" aria-busy={status === "asking"}>
      {status === "asking" ? (
        <p className="ans__lead">Reading the numbers…</p>
      ) : (
        <>
          {lead ? <p className="ans__lead">{lead}</p> : null}
          {/* `MStrip` reads the same `FigureProps` quartet; a figure filed by
              the model carries no `reference`, so the phone cell's band —
              which opens only inside `reference ? … : ''` — is correctly
              absent rather than silently swallowing a caption. */}
          {cells.length > 0 ? (
            figures === "mstrip" ? <MStrip cells={cells} /> : <Strip cells={cells} />
          ) : null}
          {caveat ? <p className="callout">{caveat}</p> : null}
          {!empty && note ? <p className="ans__lead">{note}</p> : null}

          {/* K-R2: an answer names what it read, or it does not ship. The
              labels are `TOOL_LABELS`' own — the thinking indicator in the
              editorial chat has said "sales", "invoices", "recipes" for
              months, and a second vocabulary for the same 116 tools would
              be two names for one source. */}
          {answer && answer.read.length > 0 ? (
            <div className="srcs">
              <span className="src">Read</span>
              {answer.read.map((name) => (
                <span className="src" key={name}>
                  <b>{labelFor(name).short}</b>
                </span>
              ))}
            </div>
          ) : null}

          {/* No click handler of its own in the palette: `data-askabout` is
              caught by the one document-level delegation `AskSurface` already
              mounts, so a follow-up pre-fills the input exactly as a
              suggestion row does (F-R10). One path in, not two. */}
          {filed && filed.followUps.length > 0 ? (
            <div className="sugs">
              {filed.followUps.map((q) =>
                onFollowUp ? (
                  <button className="sug" type="button" key={q} onClick={() => onFollowUp(q)}>
                    {q}
                  </button>
                ) : (
                  <button className="sug" type="button" key={q} data-askabout={q}>
                    {q}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export function AskAnswerPane({
  state,
  context,
  openHref = "/dashboard/ask",
  onBack,
  onLeave,
}: {
  state: AskState
  context: AskContext
  /**
   * Where "Open in Ask" goes. Built by `AskSurface`, which is the only thing
   * holding both the question and the search params the scope came from — a
   * bare `/dashboard/ask` would open the page on no question and the default
   * window, which is not the answer the reader is looking at.
   */
  openHref?: string
  /** "Back to search" — the answer goes, the typed question stays (F-R10). */
  onBack: () => void
  /** A destination was taken; the palette should get out of the way. */
  onLeave: () => void
}) {
  const question = askQuestion(state)

  return (
    <div className="askans">
      <div className="askans__q">
        <AskGlyph />
        <span>{question}</span>
      </div>

      <AskAnswerBody state={state} />

      <div className="askans__foot">
        {/* `context`, not `filed.scope`: both name a store and a window, and
            only one of them was derived from the URL the reader is looking at.
            The model's scope string is its own account of what it read and is
            allowed to differ; the foot is a statement about this surface. */}
        <span>
          {context.store} · {context.range}
        </span>
        <span className="spacer" />
        <button className="btn btn--quiet" type="button" onClick={onBack} data-askback>
          Back to search
        </button>
        {/* Task 3's route. The rail has pointed at it since it was built, so
            this is the status quo rather than a link this task invented. */}
        <Link className="btn" href={openHref} onClick={onLeave}>
          Open in Ask
        </Link>
      </div>
    </div>
  )
}
