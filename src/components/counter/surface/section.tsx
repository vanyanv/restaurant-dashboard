import { useId, type ReactNode } from "react"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Skeleton } from "@/components/counter/state/skeleton"
import { Failed } from "@/components/counter/state/failed"
import { Empty } from "@/components/counter/state/empty"
import { StaleBanner } from "@/components/counter/state/stale"
import { Owed } from "@/components/counter/state/owed"
import { AskGlyph } from "./ask-glyph"

/**
 * The keystone. Prototype note 22 in one component, on the prototype's own DOM.
 *
 * Ported from `sec()` at line 3037 of `docs/counter/counter-prototype.html`:
 *
 *   <div class="sec">
 *     <div class="sec__head">
 *       <h3>title</h3>
 *       <span class="k">meta</span>            — ok state only
 *       <button class="askmini">…</button>     — ok state only
 *     </div>
 *     <div class="sec__body">body</div>        — unless the body brings its own padding
 *   </div>
 *
 * A page author writes `<Section title="…" data={x}>{d => …}</Section>` and
 * gets all six states, correctly, with no opportunity to get them wrong —
 * because `children` is a function that only runs when data exists. There is no
 * code path in which a page renders a figure that is not there. This is also
 * why `npm run tokens` forbids a page from inspecting `SectionData.status`:
 * the check belongs here, once.
 *
 * WHAT THE PROTOTYPE SWAPS, AND WHAT IT KEEPS. `sec()` keeps the head in every
 * state and replaces only the body — so a section that failed still says which
 * section failed. Two details of that are easy to get backwards and both are
 * the prototype's, not the brief's:
 *
 *   1. `meta` is gated on `st === 'ok'` exactly like `askmini` is. The brief
 *      says "the head with its title and meta renders in every state"; the
 *      prototype writes `(st === 'ok' && meta ? …)`. Only the TITLE survives
 *      every state. That is also the behaviour our Section already had
 *      ("shown only with data"), so the prototype and the shipped code agree
 *      and the brief is the odd one out.
 *   2. The empty body is NOT wrapped in `.sec__body`. `sec()` writes
 *      `head + bodyEmpty(title) + '</div>'` for empty and
 *      `head + '<div class="sec__body">' + … for loading and error. That is
 *      deliberate: `.empty` is `padding:46px 20px` in its own right
 *      (counter-components.css:227), so wrapping it would pad it twice and
 *      give the tall empty state a 13px inset it is not designed to have.
 *
 * `pad={false}` is `raw()` — "this body brings its own padding", which is what
 * `tbl()` returns, so a Section whose only child is a Table passes it.
 */
export function Section<T>({
  title,
  meta,
  data,
  askAbout,
  onRetry,
  pad = true,
  children,
}: {
  title: string
  /** A short qualifier — the range, the store, the row count. Shown only with data. */
  meta?: string
  data: SectionData<T>
  /** `true` asks about the section by its title; a string asks about that instead. */
  askAbout?: boolean | string
  onRetry?: (action: string) => void
  /**
   * The prototype's `raw()`. `false` drops `.sec__body` so a body that already
   * pads itself — a `Table`, which fills the section edge to edge — is not
   * inset a second time.
   */
  pad?: boolean
  children: (data: T) => ReactNode
}) {
  const withData = hasData(data)
  const headingId = useId()

  // The button carries the QUESTION, not the title: `true` means "ask about
  // this section by its own title", a string overrides it. The prototype
  // strips HTML tags out of the value because its titles are HTML fragments;
  // ours are plain strings, but stripping is still the honest thing to do with
  // a caller-supplied string that becomes an attribute.
  //
  // The prototype's second replace — `"` -> `&quot;` — is deliberately NOT
  // ported. It is hand-written HTML escaping for a string being concatenated
  // into an attribute by hand. JSX escapes attribute values itself, so doing
  // it again would put a literal `&quot;` into the DOM and hand the Ask
  // surface a question with entity noise in it.
  const asked = askAbout === true ? title : askAbout
  const question = asked ? asked.replace(/<[^>]+>/g, "") : null

  let body: ReactNode
  if (data.status === "loading") {
    body = (
      <div className="sec__body">
        <Skeleton />
      </div>
    )
  } else if (data.status === "failed") {
    body = (
      <div className="sec__body">
        <Failed title={title} error={data.error} retryAction={data.retryAction} onRetry={onRetry} />
      </div>
    )
  } else if (data.status === "empty") {
    // No `.sec__body` — see the note above. `.empty` pads itself.
    body = <Empty reason={data.reason} />
  } else if (data.status === "not_computed") {
    // OUR sixth state; the prototype has no equivalent. It goes where every
    // other body goes rather than replacing the section, so a reader still
    // gets the title of the thing that is owed.
    body = (
      <div className="sec__body">
        <Owed owed={data.owed} />
      </div>
    )
  } else {
    const inner = (
      <>
        {data.status === "stale" ? <StaleBanner lastGoodAt={data.lastGoodAt} /> : null}
        {children(data.data)}
      </>
    )
    body = pad ? <div className="sec__body">{inner}</div> : inner
  }

  return (
    // `<section aria-labelledby>` rather than the prototype's bare `<div>`.
    // The class is what the ported sheet and the fidelity gate both key on,
    // and a `<section>` computes identically to a `<div>` — this only adds the
    // landmark role and the accessible name the prototype never had.
    <section className="sec" aria-labelledby={headingId}>
      <div className="sec__head">
        <h3 id={headingId}>{title}</h3>
        {withData && meta ? <span className="k">{meta}</span> : null}
        {/* Note 55: this button was rendered on fifty pages and wired to
            nothing. It appears only when there is an answer to ask about —
            asking about a section that failed to load is asking about
            nothing — and it carries the question with it so the Ask surface
            does not have to guess. */}
        {withData && question ? (
          <button type="button" className="askmini" data-askabout={question}>
            <AskGlyph />
            Ask about this
          </button>
        ) : null}
      </div>
      {body}
    </section>
  )
}
