import { Suspense, use, useId, type ReactNode } from "react"
import {
  hasData,
  isPendingSource,
  loading,
  stale,
  type SectionData,
  type SectionSource,
} from "@/lib/counter/section-data"
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
 *
 * ## `bare` — a state wrapper that is not a `.sec`
 *
 * Four of the prototype's Overview blocks are NOT sections and must not emit
 * `.sec`: the head block (line 4243), the strip (4256), the moving band (4295)
 * and the comparison drill (4340). All four sit at page level, above and
 * between the six real sections — and all four still have states. `headBlock()`
 * is itself a state wrapper: it reads `eff()` and substitutes a skeleton for
 * `loading` and a build-out body for `empty`.
 *
 * So the choice is between a SECOND component that renders the six states, or
 * one flag here. Task 6 named the first option and refused it — `Section` is
 * the sole state renderer (R3) — and two implementations of "what does failed
 * look like" is exactly the drift that rule exists to prevent. `bare` is the
 * second option: the same six branches, the same five state components, with
 * the `.sec` chrome dropped. Nothing about a state changes; only the box
 * around it does.
 *
 * `bare` implies no `.sec__head` (there is no head to put a title in) and no
 * `.sec__body` (there is no section body to pad), so `meta`, `askAbout` and
 * `pad` say nothing in that mode. `title` is still REQUIRED, and still
 * load-bearing: it is what `Failed` names, so a head block that could not load
 * says which block it was.
 */
/**
 * ## Streaming, and why the boundary is HERE and not in the page
 *
 * Task 3 of the streaming-architecture plan. `data` now takes the PROMISE of a
 * `SectionData` as well as a resolved one; when it is a promise this component
 * mounts its own `<Suspense>`, renders the section's own loading skeleton as
 * the fallback, and unwraps the value with React 19's `use()` inside it. One
 * slow query therefore holds up one section and nothing else — which is the
 * whole of what the owner asked for: *"different data is isolated for
 * components so they don't block each other."*
 *
 * The boundary lives in this component rather than in each page for the same
 * reason every state does. The spec is binding on all fifty-four Counter
 * pages, each of which is written by copying the last one; a `<Suspense>` a
 * page author has to remember is a `<Suspense>` some page will not have, and
 * that page's regression is invisible until someone measures it. Here it is
 * structural: passing a promise IS the boundary, and there is no way to pass
 * one without getting it.
 *
 * It also settles what the fallback looks like without a second answer. The
 * fallback is this same component rendering `loading()` — the same `.sec`, the
 * same head, the same title, the same `Skeleton` the eight `loading.tsx` files
 * already compose, in the same box the resolved section will occupy. Nothing
 * moves when the value lands, and there is still exactly one renderer of
 * "not here yet".
 *
 * A PAGE STILL CANNOT BRANCH ON A STATUS, and could not use one if it wanted:
 * a promise has no `.status` to read, and the resolved value never reaches the
 * page at all. `npm run tokens`' `no-status-branch` rule survives this change
 * untouched.
 */
export function Section<T>({ data, ...chrome }: SectionProps<T>) {
  if (isPendingSource(data)) {
    return (
      // The fallback is the section's own loading state, so the head, the
      // title and the box are already on screen and only the body swaps.
      <Suspense fallback={<SectionBody<T> {...chrome} data={loading<T>()} />}>
        <PendingSection<T> {...chrome} source={data} />
      </Suspense>
    )
  }
  return <SectionBody<T> {...chrome} data={data} />
}

/**
 * The suspending half. It exists as its own component because a Suspense
 * boundary only catches what is rendered INSIDE it — a `use()` called in the
 * component that renders the `<Suspense>` suspends the parent instead, which
 * would hand the whole page back to `loading.tsx` and undo the isolation.
 */
function PendingSection<T>({
  source,
  ...chrome
}: Omit<SectionProps<T>, "data"> & { source: Promise<SectionData<T>> }) {
  return <SectionBody<T> {...chrome} data={use(source)} />
}

type SectionProps<T> = {
  title: string
  /**
   * A short qualifier — the range, the store, the row count. Shown only with
   * data.
   *
   * A FUNCTION when the qualifier is derived from the section's own data
   * ("2 lines · 1 modifier", "6 shown"). Three pages used to lift that value
   * out with `dataOf(sections.x)` and pass the string down; with `x` a promise
   * there is nothing to lift, and the honest place to read it is here, where
   * the value has already arrived and the section already knows whether there
   * is one. It returns `undefined` for "no meta at all", exactly as the string
   * form's absence does.
   */
  meta?: string | ((data: T) => string | undefined)
  data: SectionSource<T>
  /** `true` asks about the section by its title; a string asks about that instead. */
  askAbout?: boolean | string
  onRetry?: (action: string) => void
  /**
   * The prototype's `raw()`. `false` drops `.sec__body` so a body that already
   * pads itself — a `Table`, which fills the section edge to edge — is not
   * inset a second time.
   */
  pad?: boolean
  /**
   * Drop the `.sec` wrapper, the `.sec__head` and the `.sec__body`, keeping
   * only the state body. For the prototype's page-level blocks — see above.
   */
  bare?: boolean
  /**
   * Task 4 of the streaming-architecture plan: true while a `useTransition`
   * navigation is in flight for a filter, range, store or search change —
   * see `useCounterTransition` and the `push` in each page client and in
   * `AppShell`/`PhoneShell`.
   *
   * Reclassifies THIS section's already-resolved data for exactly the
   * duration of that transition, in `SectionBody`:
   *
   *   - `ready` (or an already-`stale` section) becomes `stale` — there is
   *     something on screen, so the reader sees the LAST GOOD figures with
   *     `StaleBanner` saying a refetch is running. This is `stale`'s designed
   *     job, and nothing constructs it any other way: no adapter calls
   *     `stale()` today (see `section-data.ts`), so this is the only place it
   *     becomes reachable.
   *   - everything else (`loading`/`failed`/`empty`/`not_computed` — nothing
   *     worth keeping on screen) becomes `loading`. This is `SectionData.loading`'s
   *     OTHER reachable path, beside the Suspense fallback Task 3 covers for a
   *     first paint: this one is a refetch with nothing to show.
   *
   * Defaults to `false`, so every existing caller and every existing test —
   * none of which passes this — is unaffected.
   */
  pending?: boolean
  children: (data: T) => ReactNode
}

/**
 * The six states, on the prototype's own DOM. Everything above this line is
 * about WHEN it runs; this is the part that has always been here.
 */
function SectionBody<T>({
  title,
  meta,
  data: rawData,
  askAbout,
  onRetry,
  pad = true,
  bare = false,
  pending = false,
  children,
}: Omit<SectionProps<T>, "data"> & { data: SectionData<T> }) {
  /*
   * `Section` is deliberately NOT a client component (see the file's own
   * note above `EntryItem` in `app-shell.tsx` and this component's use from
   * every `loading.tsx`, a Server Component) — so no `useEffect`/`useRef`
   * here, ever. `new Date()` at the moment of reclassification is not a
   * running clock: this component only re-renders when `pending` or
   * `rawData` actually changes (props are otherwise stable across a
   * transition), so it renders once when the transition STARTS — which is
   * exactly "the last confirmed good moment" for the data being frozen — and
   * once more when it ends with fresh data. See `pending`'s doc comment on
   * `SectionProps` for the two branches below.
   */
  const data: SectionData<T> = !pending
    ? rawData
    : rawData.status === "ready"
      ? stale(rawData.data, new Date())
      : rawData.status === "stale" || rawData.status === "loading"
        ? rawData
        : loading<T>()

  const withData = hasData(data)
  // The qualifier, resolved once the value is in hand — see `meta` above.
  const metaText = hasData(data)
    ? typeof meta === "function"
      ? meta(data.data)
      : meta
    : undefined
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

  // `wrap` is where `.sec__body` is decided, once. In `bare` mode it never
  // wraps — there is no section body — but every state below is otherwise the
  // same markup it has always been.
  const wrap = (node: ReactNode, inBody: boolean): ReactNode =>
    inBody && !bare ? <div className="sec__body">{node}</div> : node

  let body: ReactNode
  if (data.status === "loading") {
    body = wrap(<Skeleton />, true)
  } else if (data.status === "failed") {
    body = wrap(
      <Failed title={title} error={data.error} retryAction={data.retryAction} onRetry={onRetry} />,
      true,
    )
  } else if (data.status === "empty") {
    // No `.sec__body` — see the note above. `.empty` pads itself.
    body = <Empty reason={data.reason} />
  } else if (data.status === "not_computed") {
    // OUR sixth state; the prototype has no equivalent. It goes where every
    // other body goes rather than replacing the section, so a reader still
    // gets the title of the thing that is owed.
    body = wrap(<Owed owed={data.owed} />, true)
  } else {
    const inner = (
      <>
        {data.status === "stale" ? <StaleBanner lastGoodAt={data.lastGoodAt} /> : null}
        {children(data.data)}
      </>
    )
    body = wrap(inner, pad)
  }

  // A page-level block: the states, without the box. The head block, the
  // strip, the moving band and the comparison drill are all this.
  if (bare) return <>{body}</>

  return (
    // `<section aria-labelledby>` rather than the prototype's bare `<div>`.
    // The class is what the ported sheet and the fidelity gate both key on,
    // and a `<section>` computes identically to a `<div>` — this only adds the
    // landmark role and the accessible name the prototype never had.
    <section className="sec" aria-labelledby={headingId}>
      <div className="sec__head">
        <h3 id={headingId}>{title}</h3>
        {metaText ? <span className="k">{metaText}</span> : null}
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
