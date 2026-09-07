"use client"

import Link from "next/link"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"
import { Strip } from "@/components/counter/surface/strip"
import { MStrip } from "@/components/counter/shell/m-strip"
import { Thinking } from "@/components/counter/ask/thinking"
import { TurnFoot, type TurnFootProps } from "@/components/counter/ask/turn-foot"
import { AskShow } from "@/components/counter/ask/ask-show"
import { CacheTag, HowIGotHere, ReadRow } from "@/components/counter/ask/read-row"
import type { FigureProps } from "@/components/counter/surface/figure"
import { labelFor } from "@/components/chat/tool-labels"
import type { AskContext } from "@/lib/counter/ask-context"
import {
  askAnswer,
  askFailure,
  askQuestion,
  askReading,
  type AskState,
} from "@/lib/counter/ask-state"

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
 * THE PICTURE, AND WHY IT IS NOT A SECOND CHART
 * ---------------------------------------------------------------------------
 *
 * Between the prose and the sources sit up to two `Section`s holding a `Chart`
 * or a `Table` — the prototype's own `sec(…, chart(…))` and `sec(…, tbl(…))`
 * at 4504, and 11 of the 19 landmarks the fidelity report has listed as
 * missing on this route since it shipped.
 *
 * Neither is drawn by this file and neither is typed by the model. The payload
 * is built on the server from the rows the tool already returned
 * (`src/lib/chat/present.ts`) and rendered through the same `Chart` and
 * `Table` the pages use, so a chart in an answer is the chart the page would
 * have drawn — hover, tooltip, draw-on and all. `AskShow` defers the chunk;
 * see its note for why that is correct rather than merely cheap.
 *
 * ---------------------------------------------------------------------------
 * THE SCOPE ROW, AND WHY IT IS USUALLY ABSENT
 * ---------------------------------------------------------------------------
 *
 * An answer is computed for one store and one window. The reader can then
 * move both — the date control sits in this page's own head — and until this
 * row existed nothing said so: the head, the composer's scope chips and the
 * answer read as one statement about one window, with the answer three weeks
 * stale and no way to tell.
 *
 * So the row is not "the scope". It is "the scope is no longer what you are
 * looking at", and it renders only when the two have actually diverged; when
 * they agree, two other things on the page already say it. The button asks
 * the same question again under the scope the surface is set to NOW, which is
 * the one the page can express exactly.
 *
 * The scope it prints is the turn's own, never the live context — a restored
 * turn recovers it from the sentence stored in front of its question
 * (`scopeFromSentence`), so an answer opened next month still names the
 * window it was actually computed for.
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
  rescope,
  onFresh,
  foot,
}: {
  state: AskState
  className?: string
  /** The verdict is the page's `<h2>`; do not print it here as well. */
  verdictShownAbove?: boolean
  /** Present on a surface that answers a follow-up itself; absent in the palette. */
  onFollowUp?: (question: string) => void
  /** `.strip` on the desk's two surfaces, `.mstrip` on the phone. */
  figures?: "strip" | "mstrip"
  /**
   * The scope the SURFACE is set to now, and how to ask this question again
   * under it.
   *
   * Passed by the two Ask pages, which carry a date control and a store
   * switcher that can both move while an answer sits on screen. NOT passed by
   * the palette: it answers one question and is dismissed with Escape, so its
   * scope cannot drift out from under the answer and a row saying so would be
   * a row that never fires.
   */
  rescope?: {
    store: string
    range: string
    /** `follow(question, currentContext)` — the page already has that. */
    onAsk: (question: string) => void
  }
  /**
   * The turn footer (cost, seconds, thumbs, fork, copy) — the page passes
   * it; the palette does not, because a palette answer is one question and
   * one answer, dismissed with Escape, and has no turn to keep (D2 of the
   * front-door spec). `read` and `copyText` are filled in here from the
   * answer, so the caller names only what it alone knows.
   */
  /**
   * "Re-ask fresh" on an answer served from the cache: the same question,
   * sent again with `fresh: true`, so the model runs. Omitted in the palette.
   */
  onFresh?: (question: string) => void
  foot?: Omit<TurnFootProps, "read" | "copyText">
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
  /*
   * HAS THE PAGE MOVED OUT FROM UNDER THIS ANSWER?
   *
   * Only then is there anything to say. When the two agree, the head and the
   * composer's own scope chips have said it already and a third copy is noise
   * — so this row is not "the scope", it is "the scope is no longer what you
   * are looking at", which is a different and much rarer statement.
   */
  const answered = answer?.scope ?? null
  const storeMoved = Boolean(answered && rescope && answered.store !== rescope.store)
  const rangeMoved = Boolean(answered && rescope && answered.range !== rescope.range)
  const moved = storeMoved || rangeMoved
  // Name only what actually changed. "Ask again for Hollywood · Aug 24 – 30"
  // when the store did not move claims a change the reader did not make.
  const rescopeLabel =
    rescope && storeMoved && rangeMoved
      ? `${rescope.store} · ${rescope.range}`
      : rescope && storeMoved
        ? rescope.store
        : (rescope?.range ?? "")

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
  const copyText = [
    filed?.verdict ?? "",
    ...filedFigures.map((f) => `${f.label}: ${f.value}${f.delta ? ` (${f.delta})` : ""}`),
    answer?.body ?? "",
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <div
      // `is-cached`: an instant answer enters as one flat fade, not a
      // narrated arrival — see counter-repairs.css, "an instant answer".
      className={`${className}${answer?.meta?.cached ? " is-cached" : ""}`}
      aria-live="polite"
      aria-busy={status === "asking"}
    >
      {status === "asking" ? (
        /*
         * Was a single static line, "Reading the numbers…", for the whole
         * turn — 32.8 of 33.8 seconds unchanged, measured in a browser, while
         * the surface already knew which tools had been called and which had
         * come back. `Thinking` says it. The prototype designed this state and
         * its CSS shipped with nothing emitting it; see that component.
         */
        <Thinking steps={askReading(state)} />
      ) : (
        <>
          {/* Above everything, because it qualifies everything below it. */}
          {answer && answered && rescope && moved ? (
            /* `--was`, not a bare `.scoperow`: the composer has one of these
               saying what the NEXT question is asked against, and the phone
               hides its opening label for room. Reading "STORE Glendale"
               with no "Answered for" in front of it turns this row into that
               one, which is the opposite claim. */
            <div className="scoperow scoperow--was">
              <span>Answered for</span>
              <span className="chip">
                <span className="lbl">Store</span> {answered.store}
              </span>
              <span className="chip">
                <span className="lbl">Range</span> {answered.range}
              </span>
              <button
                type="button"
                className="rerun"
                onClick={() => rescope.onAsk(answer.question)}
              >
                Ask again for {rescopeLabel}
              </button>
            </div>
          ) : null}
          {answer ? (
            <CacheTag
              meta={answer.meta}
              onFresh={onFresh ? () => onFresh(answer.question) : undefined}
            />
          ) : null}
          {lead ? <p className="ans__lead">{lead}</p> : null}
          {/* `MStrip` reads the same `FigureProps` quartet; a figure filed by
              the model carries no `reference`, so the phone cell's band —
              which opens only inside `reference ? … : ''` — is correctly
              absent rather than silently swallowing a caption. */}
          {cells.length > 0 ? (
            figures === "mstrip" ? <MStrip cells={cells} /> : <Strip cells={cells} />
          ) : null}
          {caveat ? <p className="callout">{caveat}</p> : null}
          {/* COULD NOT FINISH ("Ask in Motion II", D). A source that did not
              come back is named in place, beside the ones that did, and the
              answer above it is whatever those could support. One retry —
              the same question, past the cache — and no guessed page link. */}
          {answer && answer.meta && answer.meta.failed.length > 0 ? (
            <div className="ansfail">
              <span className="rk">What I could still read</span>
              {answer.read.map((r) => (
                <div className="rsrc" key={r.tool}>
                  <b>{labelFor(r.tool).short}</b>
                  <span>{r.params ?? "complete"}</span>
                </div>
              ))}
              {answer.meta.failed.map((t) => (
                <div className="rsrc is-out" key={t}>
                  <b>{labelFor(t).short}</b>
                  <span>did not come back</span>
                </div>
              ))}
              {onFresh ? (
                <div className="btnrow">
                  <button className="btn btn--primary" type="button" onClick={() => onFresh(answer.question)}>
                    Try again
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {!empty && note ? <p className="ans__lead">{note}</p> : null}

          {/* The prototype's two `sec()`s under the verdict — a chart and a
              table, built server-side from the rows a tool returned and
              chosen by the model's own `fileReturn.show`. On every surface,
              because an answer opened in the palette and the same answer
              opened on the page have to be the same answer; the chunk is
              deferred (see `AskShow`) so no route pays for it unasked. */}
          {answer && answer.shown.length > 0 ? <AskShow shown={answer.shown} /> : null}

          {/* K-R2: an answer names what it read, or it does not ship. The
              labels are `TOOL_LABELS`' own — the thinking indicator in the
              editorial chat has said "sales", "invoices", "recipes" for
              months, and a second vocabulary for the same 116 tools would
              be two names for one source. */}
          {/* K-R2: an answer names what it read, or it does not ship. The
              chips are verified (curated loaders, never free-form SQL) and
              carry each source's own sync clock; "How I got here" under them
              opens the exact calls. See `read-row.tsx`. */}
          {answer && answer.read.length > 0 ? (
            <>
              <ReadRow read={answer.read} />
              <HowIGotHere read={answer.read} meta={answer.meta} />
            </>
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
          {foot && answer ? <TurnFoot {...foot} read={answer.read} copyText={copyText} /> : null}
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
