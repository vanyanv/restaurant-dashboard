"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  PhoneSheet,
  Section,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskAnswerBody,
  AskComposer,
  Conversations,
  ConversationsRail,
  Stopped,
} from "@/components/counter/ask"
import type { ConversationActions } from "@/components/counter/ask/conversations"
import { ListGlyph } from "@/components/counter/ask/rail-glyphs"
import {
  deleteAllAskThreads,
  deleteAskThread,
  forkAskThread,
  rateAskTurn,
  renameAskThread,
} from "@/lib/counter/actions/conversation"
import type { AskFeedback } from "@/lib/counter/ask-feedback"
// BY PATH, not through the ask barrel: it reaches a `"use server"` module and
// the barrel is shared with the overview clients. See that barrel's own note.
import { ThreadActions } from "@/components/counter/ask/thread-actions"
import { ASK_PHONE_ROUTE, ASK_STARTERS, describeAskContext } from "@/lib/counter/ask-context"
import { rangeLabel } from "@/lib/counter/date-range"
import { readCounterParams } from "@/lib/counter/url-state"
import {
  askAnswer,
  askPending,
  askStopped,
  askTurnsFor,
  restoredAskState,
} from "@/lib/counter/ask-state"
import { useAskDeferred } from "@/lib/counter/use-ask-deferred"
import { threadDayLabel, threadTurnLabel } from "@/lib/counter/thread-groups"
import type {
  AskConversation,
  AskSections,
  AskThread,
  AskTurn,
} from "@/lib/counter/adapters/ask"
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
 * `/m/chat` — the pre-Counter phone chat — was retired on 2026-09-04 and is
 * now a shim onto this route, which `src/proxy.ts` maps `/dashboard/chat` to
 * as well. It survived this long on the claim that this surface had no thread
 * history; the section below is that history, and `urlConversationId` opens
 * one from `?c=`.
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

  const {
    turns,
    state,
    conversationId,
    ask,
    follow,
    stop,
    askedAt,
    reset,
    engineMount,
  } = useAskDeferred(urlConversationId)

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
  /*
   * The discriminator is whether THIS SESSION has turns on screen — not
   * whether the ids match. `useAsk` seeds its `conversationId` from the very
   * `?c=` this section was loaded for, so an id comparison was true of every
   * thread opened from history and froze it to `[]`: the phone opened a stored
   * thread to its name, a Rename/Delete row, and nothing else. Same defect as
   * the desk's, fixed the same way — see `counter-ask-client.tsx`.
   */
  const frozenThread = useRef<{ id: string; turns: AskTurn[] } | null>(null)
  const liveTurnCount = useRef(0)
  liveTurnCount.current = turns.length
  const storedTurns = useCallback((t: AskThread) => {
    if (frozenThread.current?.id !== t.id) {
      frozenThread.current = { id: t.id, turns: liveTurnCount.current > 0 ? [] : t.turns }
    }
    return frozenThread.current.turns
  }, [])

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
  /*
   * THE THREADS SHEET — the desk's rail, as a bottom sheet the head opens.
   * The mock replaced the list of past threads under the composer with this:
   * the same search, groups and ⋯ actions, reached from "Threads" and closed
   * by choosing one. `?cq=` still carries the search so a filtered sheet is
   * the same link it is on the desk.
   */
  const [sheet, setSheet] = useState(false)
  const [typed, setTyped] = useState(params.get("cq") ?? "")
  useEffect(() => {
    const current = params.get("cq") ?? ""
    if (typed === current) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      const q = typed.trim()
      if (q) next.set("cq", q)
      else next.delete("cq")
      const qs = next.toString()
      router.replace(qs ? `${ASK_PHONE_ROUTE}?${qs}` : ASK_PHONE_ROUTE, { scroll: false })
    }, 300)
    return () => clearTimeout(t)
  }, [typed, params, router])

  // Opening a thread is a NAVIGATION, so the back button walks out of a thread
  // the same way it leaves any other screen — the phone has no palette to
  // close and no Escape key.
  const openThread = useCallback(
    (id: string) => {
      setSheet(false)
      const next = new URLSearchParams(paramsString)
      next.set("c", id)
      next.delete("q")
      router.push(`${ASK_PHONE_ROUTE}?${next.toString()}`, { scroll: false })
    },
    [router, paramsString],
  )
  const newThread = useCallback(() => {
    setSheet(false)
    setTyped("")
    closeThread()
  }, [closeThread])

  const railActions = useMemo<ConversationActions>(
    () => ({
      onRename: async (id, title) => {
        const r = await renameAskThread({ id, title })
        if (!r.ok) return r.error
        router.refresh()
        return null
      },
      onDelete: async (id) => {
        const r = await deleteAskThread({ id })
        if (!r.ok) return r.error
        if (id === urlConversationId) closeThread()
        else router.refresh()
        return null
      },
      onFork: (c: AskConversation) => {
        if (!c.lastAnswerId) return
        void forkAskThread({ id: c.id, throughMessageId: c.lastAnswerId }).then((r) => {
          if (r.ok) openThread(r.id)
        })
      },
    }),
    [router, urlConversationId, closeThread, openThread],
  )
  const deleteAll = useCallback(async () => {
    const r = await deleteAllAskThreads()
    if (!r.ok) return r.error
    newThread()
    return null
  }, [newThread])
  const [railCount, setRailCount] = useState<number | null>(null)

  const rate = useCallback(async (chatTurnId: string | null, feedback: AskFeedback | null) => {
    if (!chatTurnId) return "This turn was not recorded, so it cannot be rated"
    const r = await rateAskTurn({ chatTurnId, feedback })
    return r.ok ? null : r.error
  }, [])
  const forkAt = useCallback(
    (threadId: string, messageId: string) => {
      void forkAskThread({ id: threadId, throughMessageId: messageId }).then((r) => {
        if (r.ok) openThread(r.id)
      })
    },
    [openThread],
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!askPending(state)) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [state])
  const liveMs = askedAt !== null ? now - askedAt : null

  const threadsButton = (
    <button
      type="button"
      className="threadsbtn"
      aria-controls="ask-threads"
      aria-expanded={sheet}
      onClick={() => setSheet(true)}
    >
      <ListGlyph />
      Threads
    </button>
  )

  return (
    /* A FRAGMENT: `.ct-root.ct-phone`, `.mtop` and `.mscroll` belong to
       `(mobile)/m/(counter)/layout.tsx`. */
    <>
      {/* Invisible. Loads the AI SDK chunk after hydration — see
          `@/lib/counter/use-ask-deferred`. */}
      {engineMount}
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
                <ThreadActions id={t.id} title={t.title} onDeleted={closeThread}>
                  {threadsButton}
                </ThreadActions>
                {storedTurns(t).map((turn, i, all) => {
                  const prev = i > 0 ? all[i - 1] : null
                  const crossed =
                    prev !== null && prev.at.toDateString() !== turn.at.toDateString()
                  const sep = crossed ? (
                    <div className="daysep">
                      {threadDayLabel(turn.at, today)} ·{" "}
                      {turn.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  ) : null
                  return turn.role === "user" ? (
                    <div key={turn.id} className="turn">
                      {sep}
                      <div className="youmsg">{turn.text}</div>
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
                      foot={{
                        meta: turn.meta,
                        onRate: (f) => rate(turn.meta?.chatTurnId ?? null, f),
                        onFork: () => forkAt(t.id, turn.id),
                      }}
                    />
                  )
                })}
              </div>
            )
          }
        </Section>
      ) : null}

      {shown.length > 0 ? (
        <div className="mchat">
          {shown.map((turn, i) => (
            <div key={turn.id} className="turn">
              {/* The question as the reader asked it. `useAsk` sends the scope
                  sentence in front of it on the wire; that plumbing is never
                  shown back to the reader. */}
              <div className="youmsg">{turn.question}</div>
              {askStopped(turn.state) ? (
                <Stopped
                  steps={askStopped(turn.state)!.steps}
                  durationMs={askStopped(turn.state)!.durationMs}
                  onContinue={() => submit(turn.question)}
                />
              ) : (
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
                foot={{
                  meta: askAnswer(turn.state)?.meta ?? null,
                  liveDurationMs: i === shown.length - 1 ? liveMs : null,
                  onRate: (f) => rate(askAnswer(turn.state)?.meta?.chatTurnId ?? null, f),
                }}
              />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {shown.length === 0 && !urlConversationId ? (
        /*
         * NOTHING ASKED YET — the mock's `.newask`, as on the desk: the store
         * named, six department starters, the last four threads, and the
         * button that opens the rest of them. See the desk client.
         */
        <div className="newask newask--phone">
          <div>
            <div className="ctx">
              Answering about <b>{context.store}</b> · {windowLabel}
            </div>
            <h2>Ask about {context.store}.</h2>
          </div>
          <div className="starters">
            {ASK_STARTERS.map(({ dept, q }) => (
              <button className="starter" type="button" key={q} onClick={() => submit(q)}>
                <span className="k">{dept}</span>
                <b>{q}</b>
              </button>
            ))}
          </div>
          <Section bare quietWhenEmpty title="Recent" data={sections.conversations}>
            {(items) =>
              items.length === 0 ? null : (
                <div className="recent">
                  <span className="k">Pick up where you left off</span>
                  {items.slice(0, 4).map((c) => (
                    <button type="button" key={c.id} onClick={() => openThread(c.id)}>
                      <b>{c.title ?? "Untitled"}</b>
                      <span>
                        {c.turns} turn{c.turns === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                  <div>{threadsButton}</div>
                </div>
              )
            }
          </Section>
        </div>
      ) : null}

      <PhoneSheet id="ask-threads" title="Threads" open={sheet} onClose={() => setSheet(false)}>
        <ConversationsRail
          query={typed}
          onQuery={setTyped}
          onNew={newThread}
          count={railCount}
          onDeleteAll={deleteAll}
        >
          <Section bare title="Conversations" data={sections.conversations}>
            {(items) => (
              <Conversations
                items={items}
                currentId={urlConversationId}
                today={today}
                onOpen={openThread}
                actions={railActions}
                onCount={setRailCount}
              />
            )}
          </Section>
        </ConversationsRail>
      </PhoneSheet>

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
        busy={askPending(state)}
        onStop={stop}
        scope={{ store: context.store, range: windowLabel }}
      />
    </>
  )
}
