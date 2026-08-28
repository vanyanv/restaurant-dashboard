"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  PageHead,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskAnswerBody,
  AskComposer,
} from "@/components/counter/ask"
import { ASK_STARTERS, askHref, describeAskContext } from "@/lib/counter/ask-context"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { askAnswer, askPending, askStateFor } from "@/lib/counter/ask-state"
import { useAsk } from "@/lib/counter/use-ask"

/**
 * Counter Ask on the desk — `P.ask` at line 4504 of
 * `docs/counter/counter-prototype.html`, in its order: the sub-line, the
 * question, the verdict, the figures, the "Read" list, the follow-ups.
 *
 * ---------------------------------------------------------------------------
 * THE TITLE IS THE VERDICT
 * ---------------------------------------------------------------------------
 *
 * The prototype's one distinctive decision, in its own comment at line 4507:
 *
 *   > The headline is the answer, so it cannot be there before the answer is.
 *
 * `P.ask.title()` returns "Why is food cost 4.2 points over plan?" once there
 * is an answer and the plain question before then. So this page's `<h2>` is
 * `filed.verdict` the moment the model files one, the question until then, and
 * the word "Ask" only when nothing has been asked at all. Nothing invents a
 * headline the answer has not earned, and `AskAnswerBody` is told the verdict
 * is above it (`verdictShownAbove`) so the same sentence is not printed twice
 * three lines apart.
 *
 * A consequence worth naming: the page's accessible name — `AppShell` labels
 * `<main>` with this heading — changes when the answer lands. That is correct.
 * The page IS the answer.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION LIVES IN THE URL
 * ---------------------------------------------------------------------------
 *
 * `?q=` is read here and nowhere else on the page; asking is a NAVIGATION.
 * A follow-up chip, a starter chip and the composer all do the same one thing
 * — `router.push(askHref(...))` — so every answer this page has ever shown is
 * at an address, and the reader's back button walks their questions backwards.
 * `askHref` also carries the store and the window, so a link opened next week
 * re-reads the window it was asked about rather than whatever "yesterday"
 * means on the day it is opened.
 *
 * `q` is the same query key the orders list uses for its free-text SEARCH.
 * That is deliberate reuse of one word for one idea — "what was typed" — and
 * `askHref`'s allowlist is what stops an orders search from arriving here as
 * a question.
 *
 * ---------------------------------------------------------------------------
 * ONE TURN (K-R4), AND NO CONVERSATION RAIL
 * ---------------------------------------------------------------------------
 *
 * The prototype wraps this page in `.askpage`, a 206px `.convs` sidebar of
 * four past threads beside the chat. That grid is NOT emitted here and the
 * page is a bare `.chat`, because there is no thread store behind it: a
 * sidebar of conversations would be four buttons that cannot restore anything.
 * History, a thread and a conversation id are the next sub-project. Asking a
 * follow-up replaces the question in the URL rather than appending a turn, and
 * the composer's placeholder says so in words rather than implying a memory
 * this page does not have.
 *
 * ---------------------------------------------------------------------------
 * NO "GO" BUTTON ROW
 * ---------------------------------------------------------------------------
 *
 * The prototype's `.btnrow` of destinations ("Open menu profit", "Ground beef,
 * all vendors") is invented from an invented answer. Nothing in `FiledReturn`
 * carries destinations, and a row of pages guessed from a department name is a
 * row of links that may not hold the answer. `AskAnswerBody` already refuses
 * that guess for the palette, for the same reason, and this page does not
 * reintroduce it — the model's own `followUps` are the offer instead.
 */

/*
 * The page's own opening questions — the palette's "Ask about Ask" group, and
 * the chips a reader who arrived from the rail is shown instead of a blank.
 *
 * They live in `ask-context.ts` because the PHONE's Ask offers the same three
 * (`/m/ask`), and two lists would have drifted the first time one was edited.
 * Still module-level, so the shell is not republished on every render.
 */

export function CounterAskClient({
  params: paramsString,
  stores,
  today,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; an instance arrives with its prototype stripped.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: [...ASK_STARTERS] })
  const { startTransition } = useCounterTransition()

  const question = (params.get("q") ?? "").trim()

  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? null

  /*
   * ONE derivation of scope, shared with the ⌘K palette (K-R1). `origin` is
   * the page the question was asked FROM, carried in `?asked=` by `askHref`;
   * without it `describeAskContext` would resolve this route's own nav item
   * and prepend "Answering about Ask" to the question, naming a department
   * that does not exist.
   */
  const context = describeAskContext({
    pathname,
    params,
    storeName,
    today,
    origin: params.get("asked"),
  })

  const { state, ask, reset } = useAsk()

  /*
   * ASK WHAT THE URL SAYS.
   *
   * Keyed on the question AND the scope sentence, so landing on a link, typing
   * a follow-up, and changing the store or the range all re-ask — everything
   * on this page moves with the store and the range, and an answer left
   * standing under a window it was not read for is the exact defect
   * `describeAskContext` exists to prevent.
   *
   * The ref makes the effect idempotent: React's development double-invoke,
   * and any re-render that changes `ask`'s identity, must not spend a second
   * request on a question already in flight.
   */
  const askedRef = useRef<string | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context
  const key = `${question} · ${context.sentence}`

  useEffect(() => {
    if (!question) {
      // Back to a bare `/dashboard/ask`. The previous answer is not this
      // page's any more, and leaving it on screen under no question is an
      // answer to a question the reader cannot see.
      if (askedRef.current !== null) {
        askedRef.current = null
        reset()
      }
      return
    }
    if (askedRef.current === key) return
    askedRef.current = key
    ask(question, contextRef.current)
  }, [question, key, ask, reset])

  /** Asking is a navigation — see the docblock. */
  const push = useCallback(
    (next: string) => {
      startTransition(() => {
        router.push(askHref({ question: next, params }), { scroll: false })
      })
    },
    [params, router, startTransition],
  )

  /** The date control and the store switcher write scope, not questions. */
  const pushParams = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  // The window named by its ENDS, as the prototype's sub-line names it
  // ("reading Aug 20 – Aug 26") and as every other Counter page names it.
  const windowLabel = rangeLabel(range, "custom")

  /*
   * The server render, and the tick before `useChat` reaches `submitted`, both
   * sit at `idle` with a question in the URL. Showing the empty state there
   * would flash "nothing asked yet" over a question the reader can read in
   * their own address bar, so a question with no state yet IS asking.
   */
  const shown = askStateFor(state, question)

  const verdict = askAnswer(shown)?.filed?.verdict?.trim() ?? ""
  const title = verdict || question || "Ask"

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      <PageHead
        title={title}
        // "Asked from Overview · Hollywood · reading Aug 20 – Aug 26". The
        // first clause is dropped, rather than guessed, when the reader came
        // from the rail and there is no page to name.
        sub={
          context.askedFrom
            ? `Asked from ${context.askedFrom} · ${context.store} · reading ${windowLabel}`
            : `${context.store} · reading ${windowLabel}`
        }
      >
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => pushParams({ presetId: id })}
          onComparison={(id) => pushParams({ comparisonId: id })}
          onStep={(direction) => pushParams({ range: stepRange(range, direction) })}
          onRange={(next) => pushParams({ range: next })}
        />
      </PageHead>

      <div className="chat">
        {question ? (
          <>
            {/* The question as the reader asked it, in the prototype's own
                bubble. `useAsk` sends the scope sentence in front of it on the
                wire; that plumbing is never shown back to the reader. */}
            <div className="youmsg">{question}</div>
            <AskAnswerBody
              state={shown}
              className="ans"
              verdictShownAbove
              // On the page a follow-up is a navigation. In the palette the
              // same chip carries `data-askabout` and is caught by the one
              // document-level delegation — here that would open the palette
              // OVER this page and answer in it.
              onFollowUp={push}
            />
          </>
        ) : (
          /*
           * NOTHING ASKED YET.
           *
           * The prototype's own empty shape (`P.ask.desk()`, `e === 'empty'`):
           * `.ansfail` with a `.rk` caption and a `.sugs` row of what CAN be
           * answered. A heading over an empty page is the failure mode this
           * project has shipped before; a page that says what it is for and
           * offers three questions it can answer is not one.
           */
          <div className="ansfail">
            <span className="rk">Nothing asked yet</span>
            <p>
              Ask about <b>{context.store}</b>, reading {windowLabel}. Every answer names the
              sources it read, and its address carries the question — so the answer is a link you
              can send.
            </p>
            <div className="sugs">
              {ASK_STARTERS.map((q) => (
                <button className="sug" type="button" key={q} onClick={() => push(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <AskComposer
        // "Ask a follow-up about this range…" is the prototype's placeholder,
        // and it would promise a thread this page does not keep. It names the
        // scope instead, which is what a question here is actually asked under.
        placeholder={`Ask about ${context.store}, reading ${windowLabel}…`}
        onSubmit={push}
        disabled={askPending(shown)}
      />
    </>
  )
}
