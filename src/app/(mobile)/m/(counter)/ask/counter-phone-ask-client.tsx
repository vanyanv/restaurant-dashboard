"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  MList,
  Section,
  useCounterTransition,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskAnswerBody,
  AskComposer,
} from "@/components/counter/ask"
import { ASK_PHONE_ROUTE, ASK_STARTERS, askHref, describeAskContext } from "@/lib/counter/ask-context"
import { rangeLabel } from "@/lib/counter/date-range"
import { readCounterParams } from "@/lib/counter/url-state"
import { askAnswer, askPending, askStateFor } from "@/lib/counter/ask-state"
import { useAsk } from "@/lib/counter/use-ask"
import { labelFor } from "@/components/chat/tool-labels"
import type { AskSections } from "@/lib/counter/adapters/ask"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Counter Ask on the phone — `P.ask.phone()` at line 4611 of
 * `docs/counter/counter-prototype.html`, in its order: the question in a
 * `.youmsg`, then one `.manswer` holding everything the model said.
 *
 * ---------------------------------------------------------------------------
 * THE VERDICT LEADS THE ANSWER; IT IS NOT A HEADLINE
 * ---------------------------------------------------------------------------
 *
 * The desk's one distinctive decision — the page TITLE is the verdict — has
 * nothing to sit in here. `.mtop` is the phone's whole chrome and it holds the
 * store and the range; the prototype's phone Ask emits no page head at all,
 * only `.mchat`. So `verdictShownAbove` is false and the verdict leads the
 * answer as its first paragraph, which is what the prototype's phone does and
 * what a reader holding a 316px column reads first anyway. Nothing is printed
 * twice on either surface: exactly one of the two places says it.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION LIVES IN THE URL, AS IT DOES ON THE DESK
 * ---------------------------------------------------------------------------
 *
 * `?q=` is read here and nowhere else; asking is a NAVIGATION, through the
 * same `askHref` the desk and `PhoneShell`'s `[data-askabout]` delegation use,
 * with `route: ASK_PHONE_ROUTE` so a question asked on the phone stays on the
 * phone rather than bouncing through the middleware. Three consequences the
 * phone needs more than the desk does: the BACK BUTTON walks the reader's
 * questions backwards (there is no palette to close and no Escape key), the
 * answer is a link that can be sent from the device it was read on, and a
 * link opened next week re-reads the window it was asked about.
 *
 * ---------------------------------------------------------------------------
 * ONE TURN (K-R4)
 * ---------------------------------------------------------------------------
 *
 * No thread, no history, no `.convs`. That was written when neither surface
 * had a thread store; the desk has one now — `/dashboard/ask` renders 39
 * stored conversations and reads a thread from `?c=` — and this surface has
 * not caught up. A follow-up here still replaces the question in the URL
 * rather than appending a turn, and the composer's placeholder names the
 * scope rather than implying a memory it does not keep.
 *
 * Two consequences worth writing down where the next person will look:
 *
 * 1. The phone is BEHIND the desk on this, not deliberately simpler than it.
 * 2. `/m/chat` — the pre-Counter phone chat — keeps conversation history
 *    (`listConversations`, 30 of them) and therefore stays. `src/proxy.ts`
 *    still maps `/dashboard/chat` to it for phones on purpose. Retiring it is
 *    the reward for giving this surface the rail and the thread, and not
 *    before: redirecting it today would take history away from the phone to
 *    tidy a route.
 */
export function CounterPhoneAskClient({
  params: paramsString,
  sections,
  stores,
  today,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  sections: SectionSources<AskSections>
  stores: SwitchableStore[]
  today: Date
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The date sheet and the store picker are `PhoneShell`'s; this island shares
  // its one transition so a question and a range change cannot each start
  // their own.
  const { startTransition } = useCounterTransition()

  const question = (params.get("q") ?? "").trim()

  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? null

  /*
   * ONE derivation of scope, shared with the desk page and the ⌘K palette
   * (K-R1). `describeAskContext` resolves both this route and `?asked=`
   * through the desk's own nav strings, so "/m/analytics" arrives as
   * Analytics and this route itself resolves to Ask — which is deliberately
   * NOT a subject, so a question asked from the rail is about the store and
   * the window and says exactly that.
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
   * ASK WHAT THE URL SAYS — the desk client's effect, unchanged, and for the
   * same reasons: keyed on the question AND the scope sentence so changing
   * the store or the range re-asks, and made idempotent by a ref so React's
   * development double-invoke cannot spend a second request.
   */
  const askedRef = useRef<string | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context
  const key = `${question} · ${context.sentence}`

  useEffect(() => {
    if (!question) {
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
        router.push(
          askHref({ question: next, params, route: ASK_PHONE_ROUTE }),
          { scroll: false },
        )
      })
    },
    [params, router, startTransition],
  )

  const windowLabel = rangeLabel(counterParams.range, "custom")

  /*
   * The server render, and the tick before `useChat` reaches `submitted`,
   * both sit at `idle` with a question in the URL. Showing the empty state
   * there would flash "nothing asked yet" over a question the reader can read
   * in their own address bar, so a question with no state yet IS asking.
   */
  const shown = askStateFor(state, question)
  const answered = askAnswer(shown)

  // `?c=` names a stored thread. Opening one is a NAVIGATION, like asking is,
  // so the back button walks out of a thread the same way it walks back
  // through questions — the phone has no palette to close and no Escape key.
  const conversationId = params.get("c")
  const threadHref = (id: string) => {
    const next = new URLSearchParams(paramsString)
    next.set("c", id)
    next.delete("q")
    return `${ASK_PHONE_ROUTE}?${next.toString()}`
  }

  return (
    /* A FRAGMENT: `.ct-root.ct-phone`, `.mtop` and `.mscroll` belong to
       `(mobile)/m/(counter)/layout.tsx`. */
    <>
      {conversationId ? (
        /*
         * A STORED THREAD, read-only, in its own `Section` so a restore gets
         * the same six states everything else does rather than a blank
         * screen. Its figures are not here and are not rebuilt: `ChatMessage`
         * keeps the prose and the tool names, never the `FiledReturn` the
         * strip was drawn from. See the adapter.
         */
        <Section bare title="This conversation" data={sections.thread}>
          {(t) =>
            t === null ? null : (
              <div className="mchat">
                {t.turns.map((turn) =>
                  turn.role === "user" ? (
                    <div className="youmsg" key={turn.id}>
                      {turn.text}
                    </div>
                  ) : (
                    <div className="manswer" key={turn.id}>
                      <p>{turn.text}</p>
                      {turn.read.length > 0 ? (
                        <div className="srcs">
                          <span className="src">Read</span>
                          {turn.read.map((name) => (
                            <span className="src" key={name}>
                              <b>{labelFor(name).short}</b>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            )
          }
        </Section>
      ) : question ? (
        <div className="mchat">
          {/* The question as the reader asked it. `useAsk` sends the scope
              sentence in front of it on the wire; that plumbing is never
              shown back to the reader. */}
          <div className="youmsg">{question}</div>
          <AskAnswerBody
            state={shown}
            className="manswer"
            // `.strip`'s track count is `data-n`; at 316px those tracks are
            // ~50px wide. `.mstrip` is the phone's own two-column grid and
            // what every other figure on a `/m` page is drawn with.
            figures="mstrip"
            // A follow-up is a navigation here too. Without this the chip
            // would carry `data-askabout`, and `PhoneShell`'s delegation
            // would push the same address one step less directly.
            onFollowUp={push}
          />
        </div>
      ) : (
        /*
         * NOTHING ASKED YET.
         *
         * The desk's empty state, in its own words, and it is not a heading
         * over a blank column: the sub-line names the store and the window
         * being read, and the three starters are questions this backend can
         * actually answer. The prototype's phone empty state is `.manswer`
         * with prose and two chips — that shape is for a question that WAS
         * asked and could not be answered, which is a refusal and arrives as
         * one (K-R3). This is the state before any question at all.
         */
        <div className="ansfail">
          <span className="rk">Nothing asked yet</span>
          <p>
            Ask about <b>{context.store}</b>, reading {windowLabel}. Every answer names the sources
            it read, and its address carries the question — so the answer is a link you can send.
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

      {/*
        * PAST QUESTIONS, and only in the state where nothing is being read.
        *
        * The desk keeps a 206px rail of conversations beside the answer; the
        * phone has no room for one and the prototype's own narrow query hides
        * it (`.askpage .convs{display:none}`). So history is what the phone
        * shows when there is nothing else to show, which is also when a
        * reader wants it — after an answer they are reading the answer.
        */}
      {conversationId === null && question === null ? (
        <Section title="What you have asked" data={sections.conversations} pad={false}>
          {(items) => (
            <MList
              rows={items.map((c) => ({
                key: c.id,
                title: c.title ?? "Untitled",
                detail: `${c.turns} ${c.turns === 1 ? "turn" : "turns"}`,
                value: "",
                href: threadHref(c.id),
              }))}
            />
          )}
        </Section>
      ) : null}

      <AskComposer
        // Named scope rather than the prototype's "Ask a follow-up about this
        // range…", which would promise a thread neither surface keeps.
        placeholder={
          answered ? `Ask again about ${context.store}…` : `Ask about ${context.store}…`
        }
        onSubmit={push}
        disabled={askPending(shown)}
      />
    </>
  )
}
