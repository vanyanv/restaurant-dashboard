"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  MList,
  Section,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskAnswerBody,
  AskComposer,
} from "@/components/counter/ask"
// BY PATH, not through the ask barrel: it reaches a `"use server"` module and
// the barrel is shared with the overview clients. See that barrel's own note.
import { ThreadActions } from "@/components/counter/ask/thread-actions"
import { ASK_PHONE_ROUTE, ASK_STARTERS, describeAskContext } from "@/lib/counter/ask-context"
import { rangeLabel } from "@/lib/counter/date-range"
import { readCounterParams } from "@/lib/counter/url-state"
import { askPending, askTurnsFor, restoredAskState } from "@/lib/counter/ask-state"
import { useAsk } from "@/lib/counter/use-ask"
import type { AskSections, AskThread, AskTurn } from "@/lib/counter/adapters/ask"
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
 * only `.mchat`. So `verdictShownAbove` is false on every turn and the verdict
 * leads each answer as its first paragraph, which is what the prototype's
 * phone does and what a reader holding a 316px column reads first anyway.
 * Nothing is printed twice on either surface.
 *
 * ---------------------------------------------------------------------------
 * IT HOLDS A CONVERSATION, AND THE ADDRESS IS THE THREAD
 * ---------------------------------------------------------------------------
 *
 * Same change as the desk, same reason, and the phone needed it more: `?q=`
 * seeds a thread, `?c=` IS the thread, and a follow-up appends a turn instead
 * of replacing the question in the URL. Measured against the live database
 * before this, **40 of 47 stored conversations held one question and one
 * answer** — the follow-up chips under every answer were asked cold.
 *
 * Three consequences the phone gets from putting the thread in the address:
 * the whole exchange survives a refresh and a backgrounded tab, it is a link
 * that can be sent from the device it was read on, and a link opened next week
 * re-reads the window it was asked about. What it costs: the back button no
 * longer walks the reader's questions backwards — it leaves the thread, which
 * is now the thing that persists.
 *
 * `/m/chat` — the pre-Counter phone chat — still exists and `src/proxy.ts`
 * still maps `/dashboard/chat` to it for phones. Retiring it is a separate
 * decision from this one.
 */
/**
 * How many past threads the phone draws. See the `meta` note on the section
 * that uses it for why there is a number here at all and why it is small.
 */
const PHONE_CONVERSATION_ROWS = 8

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

  const question = (params.get("q") ?? "").trim()
  /** `?c=` names the thread. Null on a fresh, unnamed Ask. */
  const urlConversationId = params.get("c")

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

  const { turns, state, conversationId, ask, follow, reset } = useAsk(urlConversationId)

  /*
   * ASK WHAT THE URL SAYS — the desk client's effect, unchanged, and for the
   * same reasons: keyed on the question AND the scope sentence so a `?q=` link
   * moved to another window is re-read, made idempotent by a ref so React's
   * development double-invoke cannot spend a second request, and skipped
   * entirely once the thread has an id. Inside a thread the settled turns are
   * a transcript and stay as they were read; the scope the NEXT turn carries
   * is the one the composer's placeholder is naming. See the desk client.
   */
  const askedRef = useRef<string | null>(null)
  const contextRef = useRef(context)
  contextRef.current = context
  const key = `${question} · ${context.sentence}`

  useEffect(() => {
    if (urlConversationId) return
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
  }, [urlConversationId, question, key, ask, reset])

  /*
   * THE THREAD TAKES THE ADDRESS — `replace`, not `push`, because the reader
   * did not navigate. `?q=` goes with it: the question is on screen and in the
   * thread, and a second address for one conversation is one too many.
   */
  useEffect(() => {
    if (!conversationId || conversationId === urlConversationId) return
    const next = new URLSearchParams(params)
    next.set("c", conversationId)
    next.delete("q")
    router.replace(`${ASK_PHONE_ROUTE}?${next.toString()}`, { scroll: false })
  }, [conversationId, urlConversationId, params, router])

  /*
   * THE STORED HALF OF THE THREAD, FROZEN AT THE MOMENT IT WAS OPENED.
   *
   * `sections.thread` is re-read on every navigation, so after a follow-up it
   * comes back holding the turn that is ALSO on screen live — and after a
   * fresh `?q=` it comes back holding the only turn there is. Rendering it
   * unconditionally prints turns twice; rendering it only while there are no
   * live turns makes a restored thread's history vanish the moment the reader
   * asks anything in it.
   *
   * The discriminator is whose turns the live list holds: a stored thread is
   * HISTORY unless it is the thread this session has been answering into. That
   * is decided once, when the section first resolves for a given thread, and
   * kept — `conversationId` becomes this thread's id as soon as a follow-up is
   * sent, and the answer to "was this history when I opened it" must not
   * change underneath that.
   */
  const frozenThread = useRef<{ id: string; turns: AskTurn[] } | null>(null)
  const storedTurns = useCallback(
    (t: AskThread) => {
      if (frozenThread.current?.id !== t.id) {
        frozenThread.current = { id: t.id, turns: t.id === conversationId ? [] : t.turns }
      }
      return frozenThread.current.turns
    },
    [conversationId],
  )

  /** A follow-up is a TURN, not a navigation. */
  const submit = useCallback(
    (next: string) => follow(next, contextRef.current),
    [follow],
  )

  /**
   * The thread the reader was in has been deleted — back to an empty Ask,
   * keeping the store and the window they were looking at.
   */
  const closeThread = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete("q")
    next.delete("c")
    const qs = next.toString()
    reset()
    askedRef.current = null
    router.push(qs ? `${ASK_PHONE_ROUTE}?${qs}` : ASK_PHONE_ROUTE, { scroll: false })
  }, [params, router, reset])

  const windowLabel = rangeLabel(counterParams.range, "custom")

  /*
   * The server render, and the tick before `useChat` reaches `submitted`,
   * both have no turns with a question in the URL. Showing the empty state
   * there would flash "nothing asked yet" over a question the reader can read
   * in their own address bar, so a question with no turn yet IS asking.
   */
  const shown = askTurnsFor(turns, urlConversationId ? "" : question)

  // Opening a thread is a NAVIGATION, so the back button walks out of a thread
  // the same way it leaves any other screen — the phone has no palette to
  // close and no Escape key.
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
      {/*
        * THE STORED HALF OF THE THREAD, read-only, in its own `Section` so a
        * restore gets the same six states everything else does rather than a
        * blank screen. Which turns count as stored is decided by
        * `storedTurns` — a thread opened from the rail shows all of it, a
        * thread this session started shows none, because its turns are
        * already on screen live below.
        *
        * Its figures are not here and are not rebuilt: `ChatMessage` keeps the
        * prose and the tool names, never the `FiledReturn` the strip was drawn
        * from. See the adapter.
        */}
      {urlConversationId ? (
        <Section bare title="This conversation" data={sections.thread}>
          {(t) =>
            t === null ? null : (
              <div className="mchat">
                {/* Who you are reading, and the two things you can do to it. */}
                <ThreadActions id={t.id} title={t.title} onDeleted={closeThread} />
                {storedTurns(t).map((turn) =>
                  turn.role === "user" ? (
                    <div className="youmsg" key={turn.id}>
                      {turn.text}
                    </div>
                  ) : (
                    /*
                     * THE SAME RENDERER A LIVE ANSWER GETS, in the phone's own
                     * box and with the phone's own strip. A restored turn
                     * carries its filed return now, so re-opening a thread on
                     * the phone shows the figures it showed the first time.
                     * Its follow-ups append to this thread.
                     */
                    <AskAnswerBody
                      key={turn.id}
                      state={restoredAskState(turn)}
                      className="manswer"
                      figures="mstrip"
                      onFollowUp={submit}
                    />
                  ),
                )}
              </div>
            )
          }
        </Section>
      ) : null}

      {shown.length > 0 ? (
        <div className="mchat">
          {shown.map((turn) => (
            <div key={turn.id}>
              {/* The question as the reader asked it. `useAsk` sends the scope
                  sentence in front of it on the wire; that plumbing is never
                  shown back to the reader. */}
              <div className="youmsg">{turn.question}</div>
              <AskAnswerBody
                state={turn.state}
                className="manswer"
                // `.strip`'s track count is `data-n`; at 316px those tracks are
                // ~50px wide. `.mstrip` is the phone's own two-column grid and
                // what every other figure on a `/m` page is drawn with.
                figures="mstrip"
                // A follow-up appends a turn here. Without this the chip would
                // carry `data-askabout`, and `PhoneShell`'s delegation would
                // navigate away into a new thread instead.
                onFollowUp={submit}
              />
            </div>
          ))}
        </div>
      ) : null}

      {shown.length === 0 && !urlConversationId ? (
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
            it read, follow-ups keep the thread, and its address carries the conversation — so what
            you send is the whole exchange.
          </p>
          <div className="sugs">
            {ASK_STARTERS.map((q) => (
              <button className="sug" type="button" key={q} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/*
        * PAST QUESTIONS, and only in the state where nothing is being read.
        *
        * The desk keeps a 206px rail of conversations beside the answer; the
        * phone has no room for one and the prototype's own narrow query hides
        * it (`.askpage .convs{display:none}`). So history is what the phone
        * shows when there is nothing else to show, which is also when a
        * reader wants it — inside a thread they are reading the thread.
        */}
      {!urlConversationId && shown.length === 0 ? (
        <Section
          title="What you have asked"
          data={sections.conversations}
          pad={false}
          /*
           * The count, and the fact that it is not all of it.
           *
           * The list is rendered UNCAPPED on the desk, where it has a 206px
           * rail that scrolls on its own. Here it is in the page, above the
           * composer, and the page is what scrolls — measured at 3033px with
           * thirty-nine rows on a 390x844 screen, which put the input for a
           * screen called "Ask" under two and a half screens of history.
           *
           * Capped rather than made to scroll inside itself: a scrolling box
           * inside a scrolling page is the one phone pattern that reliably
           * traps a thumb. And capped rather than paginated, because the
           * standing direction for this surface is a lean glance-and-do tool
           * — the recent few is what a phone reader is after, and the desk is
           * where the archive lives.
           *
           * The meta line says the part CSS cannot: how many are not drawn.
           */
          meta={(items) =>
            items.length > PHONE_CONVERSATION_ROWS
              ? `${PHONE_CONVERSATION_ROWS} most recent of ${items.length}`
              : `${items.length} ${items.length === 1 ? "thread" : "threads"}`
          }
        >
          {(items) => (
            <MList
              rows={items.slice(0, PHONE_CONVERSATION_ROWS).map((c) => ({
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
        // Honest now that a follow-up is a follow-up. Before the thread exists
        // it names the scope instead, which is what a first question is asked
        // under.
        placeholder={
          shown.length > 0 || urlConversationId
            ? `Ask a follow-up about ${context.store}…`
            : `Ask about ${context.store}…`
        }
        onSubmit={submit}
        disabled={askPending(state)}
      />
    </>
  )
}
