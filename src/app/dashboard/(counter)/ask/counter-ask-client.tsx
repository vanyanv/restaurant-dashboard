"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  PageHead,
  Section,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
} from "@/components/counter"
import {
  AskAnswerBody,
  AskComposer,
  Conversations,
  ConversationsRail,
  Stopped,
} from "@/components/counter/ask"
// BY PATH, not through the ask barrel: it reaches a `"use server"` module and
// the barrel is shared with the overview clients. See that barrel's own note.
import { ThreadActions } from "@/components/counter/ask/thread-actions"
import { MorningBrief, StarterChips } from "@/components/counter/ask/morning-brief"
import type { ConversationActions } from "@/components/counter/ask/conversations"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"
import {
  deleteAllAskThreads,
  deleteAskThread,
  forkAskThread,
  rateAskTurn,
  renameAskThread,
} from "@/lib/counter/actions/conversation"
import type {
  AskConversation,
  AskSections,
  AskThread,
  AskTurn,
} from "@/lib/counter/adapters/ask"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { ASK_STARTERS, describeAskContext, type AskEffort } from "@/lib/counter/ask-context"
import type { AskBrief } from "@/lib/counter/adapters/ask-brief"
import type { SectionData } from "@/lib/counter/section-data"
import type { AskFeedback } from "@/lib/counter/ask-feedback"
import { threadClock, threadDayKey, threadDayLabel, threadTurnLabel } from "@/lib/counter/thread-groups"
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

/** The window an Ask opens on when its URL names none. See `params` below. */
const ASK_DEFAULT_RANGE = "d7"

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
 * So this page's `<h2>` is the verdict of the LATEST turn the moment the model
 * files one, the question until then, and the word "Ask" only when nothing has
 * been asked at all. Nothing invents a headline the answer has not earned, and
 * that last turn is told the verdict is above it (`verdictShownAbove`) so the
 * same sentence is not printed twice three lines apart. Earlier turns print
 * their own verdict as their lead — they are no longer what the heading is
 * about, and a scrolled-back answer with no verdict would be an answer with
 * its point cut off.
 *
 * A consequence worth naming: the page's accessible name — `AppShell` labels
 * `<main>` with this heading — changes when an answer lands. That is correct.
 * The page IS the answer.
 *
 * ---------------------------------------------------------------------------
 * IT HOLDS A CONVERSATION NOW — AND THE ADDRESS IS THE THREAD
 * ---------------------------------------------------------------------------
 *
 * This page used to answer exactly one question and say so: a follow-up
 * replaced `?q=` and started again from nothing. The rail beside it was
 * titled "Conversations" and, measured against the live database, **40 of 47
 * of them held one question and one answer** — every Ask opened a thread and
 * abandoned it. The model's own follow-up chips ("Which day was weakest?")
 * were asked COLD, with no idea which week "weakest" referred to. That is the
 * one thing a chat does that a report does not, and it did not work.
 *
 * So the URL now carries the THREAD, not the question:
 *
 *   - `?q=…`  seeds a new thread. It is what an inbound link carries — the
 *     palette's "Open in Ask", a `[data-askabout]` chip — and it is asked once.
 *   - `?c=…`  IS the thread. The moment the route names the conversation, this
 *     page replaces the address with it and drops `?q=`, so what the reader
 *     copies out of the bar is the whole conversation and not its first line.
 *   - A follow-up appends a turn. It does not navigate.
 *
 * What that costs, stated plainly: the back button no longer walks a reader's
 * questions backwards, because the questions no longer each have an address.
 * The thread has one instead, it survives a refresh, and it is in the rail
 * afterwards — which the individual questions never were.
 *
 * `askHref` still builds `?q=` links for everyone arriving from elsewhere, and
 * still carries the store and the window, so a link opened next week re-reads
 * the window it was asked about.
 *
 * ---------------------------------------------------------------------------
 * A RESTORED THREAD IS ABOVE, THE LIVE ONE BELOW
 * ---------------------------------------------------------------------------
 *
 * Opening a row in the rail renders the stored turns read-only, from the
 * server, through `sections.thread` — prose and sources, never figures, since
 * `ChatMessage` does not keep the `FiledReturn` the strip was built from (see
 * the adapter). Asking from there is no longer a dead end: the composer sends
 * to the same `?c=`, the route replays the stored turns as the model's
 * history, and the new turn lands live underneath the restored ones.
 *
 * ---------------------------------------------------------------------------
 * THE RAIL IS SEARCHABLE, AND `?cq=` IS WHERE THAT LIVES
 * ---------------------------------------------------------------------------
 *
 * `searchConversations` has matched TITLES AND THE TEXT OF EVERY TURN since it
 * was written, and its own docblock says why: titles are auto-generated, so
 * "the one where produce came out at twelve thousand" is unreachable by title
 * alone. Every caller passed `""`. The rail now passes `?cq=`, so the search
 * runs where the text is — a client-side filter over a list of forty titles
 * could not have found that thread at all.
 *
 * Three details that are decisions rather than defaults:
 *
 *   - The field lives in `ConversationsRail`, OUTSIDE the `Section`. A section
 *     with no rows renders `Empty` instead of its children, so a search inside
 *     it would take itself off screen the moment it matched nothing.
 *   - The navigation is `replace` and debounced, inside the shell's one
 *     transition, so the rail holds its last good rows under a stale banner
 *     instead of blanking between keystrokes — and six letters do not cost six
 *     presses of Back.
 *   - `cq`, not `q`. One key for "a question for the model" and "a string to
 *     find among answered threads" would make searching the rail re-ask.
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
export function CounterAskClient({
  sections,
  params: paramsString,
  stores,
  today,
  brief,
  headings,
}: {
  /**
   * The query string this page was rendered for, as PLAIN TEXT — not a
   * `URLSearchParams` instance. Props cross the RSC boundary as plain
   * serialisable values only; an instance arrives with its prototype stripped.
   */
  params: string
  stores: SwitchableStore[]
  today: Date
  /** The rail's list and, when `?c=` names one, the thread being read. */
  sections: SectionSources<AskSections>
  /** The morning brief an empty Ask opens on — see `@/lib/counter/adapters/ask-brief`. */
  brief: SectionData<AskBrief> | Promise<SectionData<AskBrief>>
  /** "Good morning, Chris." / "Since Saturday", decided on the server. */
  headings: { greeting: string; since: string }
}) {
  const router = useRouter()
  const pathname = usePathname()
  /*
   * THE DEFAULT WINDOW IS SEVEN DAYS, NOT ONE. The date control is gone from
   * this page — it never constrained an answer (the range reaches the model as
   * prose the question's own words override) — so the window in the head is
   * a default, and "yesterday" is the wrong default for almost every question
   * an owner asks. A link that names a range keeps it.
   */
  const params = useMemo(() => {
    const p = new URLSearchParams(paramsString)
    if (!p.has("range") && !p.has("from") && !p.has("to")) p.set("range", ASK_DEFAULT_RANGE)
    return p
  }, [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_STARTERS.map((s) => s.q) })
  const { pending, startTransition } = useCounterTransition()

  const question = (params.get("q") ?? "").trim()
  /** The thread in the address bar. `null` on a fresh, unnamed Ask. */
  const urlConversationId = params.get("c")
  /** What the rail is searched for, from `?cq=`. */
  const railQuery = params.get("cq") ?? ""

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
   * ASK WHAT THE URL SAYS — once, and only for a thread that has no id yet.
   *
   * Keyed on the question AND the scope sentence, so a `?q=` link that arrives
   * under one window and is then moved to another is re-read rather than left
   * standing under a window it was not answered for.
   *
   * `?c=` short-circuits it entirely, and that changes what moving the range
   * means INSIDE a thread: the turns already on screen are a transcript of
   * what was asked and answered, and they stay as they were read. What moves
   * is the NEXT turn — `describeAskContext` rebuilds the scope sentence on
   * every render and `submit` sends the current one, which the composer's
   * placeholder is naming while the reader types it. Re-running three settled
   * answers against a new window would be three fresh charges for questions
   * nobody asked twice.
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
    if (urlConversationId) return
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
  }, [urlConversationId, question, key, ask, reset])

  /*
   * THE THREAD TAKES THE ADDRESS.
   *
   * `POST /api/chat` names the conversation in an `x-conversation-id` header
   * and `useAsk` captures it. `replace`, not `push`: the reader did not
   * navigate, and a history entry for "the same page, now with an id" would
   * make Back a no-op the first time it was pressed. `?q=` goes with it — the
   * question is on screen and in the thread, and leaving it in the bar would
   * be a second address for a conversation that already has one.
   */
  useEffect(() => {
    if (!conversationId || conversationId === urlConversationId) return
    const next = new URLSearchParams(params)
    next.set("c", conversationId)
    next.delete("q")
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [conversationId, urlConversationId, params, pathname, router])

  /*
   * THE RAIL LEARNS THE TURN'S NAME WHEN THE TURN SETTLES.
   *
   * `?c=` above is written from the response HEADER, before a word of the
   * answer exists, so the server rail re-renders once with an untitled row —
   * and then nothing moved it. The title (the filed verdict) and the row's
   * figure chip are written in the route's `onFinish`, which completes before
   * the stream closes; refreshing at the moment the turn stops asking is what
   * lets the row arrive named, and lets `.cv.is-new` mark the row this send
   * made. Same call the rail's rename and delete already make.
   */
  const wasAskingRef = useRef(false)
  useEffect(() => {
    const asking = askPending(state)
    if (wasAskingRef.current && !asking && conversationId) router.refresh()
    wasAskingRef.current = asking
  }, [state, conversationId, router])

  /*
   * QUICK / CAREFUL — the dock's one setting. Careful lifts the model's
   * reasoning effort for the turns that follow (see `reasoningEffortFor` in
   * the route). Page state, not composer state, so it outlives a send.
   */
  const [effort, setEffort] = useState<AskEffort>("quick")
  const effortRef = useRef(effort)
  effortRef.current = effort

  /** A follow-up is a TURN, not a navigation — see the docblock. */
  const submit = useCallback(
    (next: string) => follow(next, contextRef.current, { effort: effortRef.current }),
    [follow],
  )
  /** "Re-ask fresh" on a cached answer: the same question, past the cache. */
  const fresh = useCallback(
    (q: string) => follow(q, contextRef.current, { effort: effortRef.current, fresh: true }),
    [follow],
  )

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
   * The discriminator is whether THIS SESSION has turns on screen — not
   * whether the ids match.
   *
   * The id comparison this used to make (`t.id === conversationId`) was true
   * of every thread opened from the rail, because `useAsk` seeds its
   * `conversationId` from the very `?c=` the section was loaded for. So the
   * freeze resolved to `[]` on the first render of every restored thread and
   * the whole of Ask's history rendered as a title, a Rename/Delete row, and
   * a blank column. All 47 stored threads. The rail could find a conversation
   * and could not show one.
   *
   * `turns.length` is the fact the comparison was reaching for. A thread this
   * session started already has its turns on screen live, so its stored copy
   * is a duplicate and is dropped; a thread opened cold has none, so its
   * stored copy IS the page. Read through a ref so `storedTurns` keeps a
   * stable identity — the freeze must be decided once per thread, at the
   * moment its section first resolves, and a follow-up sent into a restored
   * thread must not re-decide it and erase the history underneath the answer.
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

  /**
   * Opening a thread IS a navigation — so a conversation the reader opened is
   * a link they can send, and the back button walks the threads they have
   * looked at rather than a hidden component state.
   *
   * `?c=` replaces `?q=`: the page is either standing in a thread or seeding a
   * new one, never both. Leaving the question in the URL would re-ask it
   * against the model the moment the thread was closed.
   */
  const openThread = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params)
      next.delete("q")
      next.set("c", id)
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  /*
   * THE RAIL'S SEARCH — a URL param, debounced, inside the shell's transition.
   *
   * In the URL rather than in component state, so a filtered rail is a link
   * and a reload keeps it, and because the search runs on the SERVER:
   * `searchConversations` matches turn text, which no client-side filter over
   * a list of titles could do.
   *
   * `replace`, not `push` — a reader typing six letters should not have to
   * press Back six times to leave. Debounced so each keystroke is not a round
   * trip, and inside `startTransition` so `Section` shows the LAST GOOD rail
   * with a stale banner rather than blanking to a skeleton between letters.
   * The input itself holds the typed text, so it never lags the keyboard while
   * the navigation it started is in flight.
   */
  const [typed, setTyped] = useState(railQuery)
  const typedRef = useRef(typed)
  typedRef.current = typed

  const onQuery = useCallback(
    (next: string) => {
      setTyped(next)
    },
    [],
  )

  useEffect(() => {
    if (typed === railQuery) return
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      const q = typedRef.current.trim()
      if (q) next.set("cq", q)
      else next.delete("cq")
      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    }, 300)
    return () => clearTimeout(t)
  }, [typed, railQuery, params, pathname, router, startTransition])

  /**
   * The thread the reader was in has been deleted. Same move as "New" minus
   * the rail's filter, which is not about the thread that just went: back to
   * an empty Ask, keeping the store and the window they were looking at.
   */
  const closeThread = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete("q")
    next.delete("c")
    const qs = next.toString()
    reset()
    askedRef.current = null
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }, [params, pathname, router, reset, startTransition])

  /** "New" drops both — an empty Ask, with the scope the reader was in kept. */
  const newThread = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete("q")
    next.delete("c")
    // …and the rail's filter with them. "New" means an empty Ask beside the
    // whole of what has been asked, not beside whatever was last searched for.
    next.delete("cq")
    const qs = next.toString()
    setTyped("")
    reset()
    askedRef.current = null
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }, [params, pathname, router, reset, startTransition])

  /*
   * THE RAIL'S FOUR VERBS. Each reaches a server action and then tells the
   * router what changed; the rail itself only reports the press (see
   * `ConversationActions`). A deleted CURRENT thread closes the page's
   * address the way the head's Delete does; any other deletion, and every
   * rename, is a refresh so the rail re-reads.
   */
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
  /** What the rail's list reported it holds — see `ConversationsRail.count`. */
  const [railCount, setRailCount] = useState<number | null>(null)

  /*
   * THE TURN FOOTER'S TWO VERBS. A thumb writes `ChatTurn.feedback` through
   * the turn's id; a turn with no id (its row was never written) accepts the
   * press and says so rather than silently doing nothing. Fork branches
   * through the assistant message and opens the branch as the current thread.
   */
  const rate = useCallback(
    async (chatTurnId: string | null, feedback: AskFeedback | null) => {
      if (!chatTurnId) return "This turn was not recorded, so it cannot be rated"
      const r = await rateAskTurn({ chatTurnId, feedback })
      return r.ok ? null : r.error
    },
    [],
  )
  const forkAt = useCallback(
    (threadId: string, messageId: string) => {
      void forkAskThread({ id: threadId, throughMessageId: messageId }).then((r) => {
        if (r.ok) openThread(r.id)
      })
    },
    [openThread],
  )

  /*
   * Seconds on the LIVE turn, before the route's metadata lands. Ticks only
   * while a turn is in flight; once `meta.durationMs` arrives the footer
   * prints that instead (D2 — a measurement, then the record).
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!askPending(state)) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [state])
  const liveMs = askedAt !== null ? now - askedAt : null

  /*
   * ESCAPE STOPS THE TURN, from anywhere on the page — the composer handles
   * its own Escape (menu first, then stop) and this catches the rest. Not
   * inside an input that is not ours: a rename's Escape means "keep the old
   * name", and `ConversationRow` stops that event before it gets here.
   */
  useEffect(() => {
    if (!askPending(state)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
      stop()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [state, stop])

  /*
   * THE WAY BACK DOWN. `.chat` scrolls; while a turn runs and the reader has
   * scrolled up to re-read something, a "New answer" pill appears instead of
   * the page yanking them to the bottom. It never scrolls on its own — the
   * reader presses it, or reaches the bottom themselves and it goes.
   */
  const chatRef = useRef<HTMLDivElement>(null)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const nearBottom = () => {
    const el = chatRef.current
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const onScroll = () => setAwayFromBottom(!nearBottom())
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])
  // A new turn: follow it only if the reader was already at the bottom.
  const turnCount = turns.length
  useEffect(() => {
    if (turnCount === 0) return
    const el = chatRef.current
    if (!el) return
    if (!awayFromBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnCount])
  const showPill = awayFromBottom && askPending(state)

  // The window named by its ENDS, as the prototype's sub-line names it
  // ("reading Aug 20 – Aug 26") and as every other Counter page names it.
  const windowLabel = rangeLabel(counterParams.range, "custom")

  /*
   * The scope the PAGE is set to, for an answer to compare itself against.
   *
   * `context.range` and not `windowLabel`: the row exists to notice that an
   * answer and the page have drifted apart, and the answer's own scope was
   * recovered from `context.sentence`, which names a preset "Yesterday" where
   * `windowLabel` names its ends "Aug 25 – Aug 25". Comparing the two
   * vocabularies would report every preset window as moved.
   */
  const rescope = useMemo(
    () => ({ store: context.store, range: context.range, onAsk: submit }),
    [context.store, context.range, submit],
  )

  /*
   * The server render, and the tick before `useChat` reaches `submitted`, both
   * have no turns with a question in the URL. Showing the empty state there
   * would flash "nothing asked yet" over a question the reader can read in
   * their own address bar, so a question with no turn yet IS asking.
   */
  const shown = askTurnsFor(turns, urlConversationId ? "" : question)

  // The newest turn scrolls into view when it is sent, smoothly unless the
  // reader asked for no motion. Nothing already on the page moves: the turn
  // rises from the composer's side (counter-repairs.css, "the whole chat")
  // and the page comes to it.
  const reduced = useReducedMotion()
  const newestRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (shown.length === 0) return
    newestRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
  }, [shown.length, reduced])
  const lastTurn = shown.length > 0 ? shown[shown.length - 1] : null

  const verdict = lastTurn ? (askAnswer(lastTurn.state)?.filed?.verdict?.trim() ?? "") : ""
  const title = verdict || lastTurn?.question || "Ask"

  return (
    /* A FRAGMENT: the rail, the topbar, the store switcher and the ⌘K surface
       belong to `(counter)/layout.tsx`. */
    <>
      {/* Invisible. Loads the AI SDK chunk after hydration — see
          `@/lib/counter/use-ask-deferred`. */}
      {engineMount}
      {/*
        * NO DATE CONTROL. It was the third place this page printed its scope
        * and the one place it pretended to constrain the answer: the window
        * reaches the model as a sentence the question's own words override,
        * so "Sep 6" in the head with "how was August" in the field answered
        * August. The head now STATES the default window; the question decides;
        * the Read row under each answer says what was actually read.
        */}
      <PageHead
        title={title}
        // "Asked from Overview · Hollywood · reading Aug 20 – Aug 26". The
        // first clause is dropped, rather than guessed, when the reader came
        // from the rail and there is no page to name.
        sub={
          context.askedFrom
            ? `Asked from ${context.askedFrom} · ${context.store} · reading ${windowLabel} unless you say otherwise`
            : `${context.store} · reading ${windowLabel} unless you say otherwise`
        }
      />

      {/*
        * `.askpage` — the prototype's two-column Ask: a 206px rail of past
        * conversations beside the answer. The phone sheet hides the rail
        * (`.askpage .convs{display:none}` in the narrow query), so this same
        * grid degrades to one column without a second layout.
        */}
      <div className="askpage">
        <ConversationsRail
          query={typed}
          onQuery={onQuery}
          onNew={newThread}
          count={railCount}
          onDeleteAll={deleteAll}
        >
          <Section
            bare
            title="Conversations"
            data={sections.conversations}
            // The shell's one transition. While a search navigation is in
            // flight the rail keeps the rows it has rather than blanking.
            pending={pending}
          >
            {(items) => (
              <Conversations
                items={items}
                currentId={urlConversationId}
                // The page's one resolved `today`, so "Today" is decided on
                // the server rather than by the reader's own clock.
                today={today}
                onOpen={openThread}
                actions={railActions}
                onCount={setRailCount}
                // The thread this session started: its row enters once.
                newId={turns.length > 0 ? conversationId : null}
              />
            )}
          </Section>
        </ConversationsRail>

        <div className="chat" ref={chatRef}>
          {/*
            * THE STORED HALF OF THE THREAD, read-only, inside its own
            * `Section` so the restore gets the same six states everything else
            * does — a skeleton while it loads, a named failure if it does not,
            * rather than a blank column.
            *
            * Which turns count as stored is decided by `storedTurns` — see
            * there. A thread opened from the rail shows all of it; a thread
            * this session started shows none of it, because its turns are
            * already on screen live below.
            *
            * Its figures are not here and are not reconstructed: `ChatMessage`
            * keeps the prose and the tool names, never the `FiledReturn` the
            * strip was built from. See the adapter.
            */}
          {urlConversationId ? (
            <Section bare title="This conversation" data={sections.thread}>
              {(t) =>
                t === null ? null : (
                  <>
                    {/* Who you are reading, and the two things you can do to
                        it. Inside the Section because the name comes with the
                        thread — there is nothing to rename until it loads. */}
                    <ThreadActions id={t.id} title={t.title} onDeleted={closeThread} />
                    {storedTurns(t).map((turn, i, all) => {
                      /*
                       * A DAY SEPARATOR where the thread crossed midnight —
                       * the mock's `.daysep`. Cut on the row's own `at`, and
                       * labelled the way the rail labels its groups so the
                       * two never disagree about what "Yesterday" is.
                       */
                      const prev = i > 0 ? all[i - 1] : null
                      const crossed =
                        prev !== null && threadDayKey(prev.at) !== threadDayKey(turn.at)
                      const sep = crossed ? (
                        <div className="daysep">
                          {threadDayLabel(turn.at, today)} ·{" "}
                          {threadClock(turn.at)}
                        </div>
                      ) : null
                      return turn.role === "user" ? (
                        <div key={turn.id} className="turn">
                          {sep}
                          <div className="youmsg">{turn.text}</div>
                        </div>
                      ) : (
                        /*
                         * THE SAME RENDERER A LIVE ANSWER GETS. A restored turn
                         * now carries its filed return, so it draws the same
                         * verdict, the same figure strip and the same follow-up
                         * chips it drew when it was first read.
                         *
                         * Its follow-ups are LIVE: `submit` appends to this
                         * thread, so a chip under an answer from last week asks
                         * its question with that week's exchange behind it.
                         */
                        <AskAnswerBody
                          key={turn.id}
                          state={restoredAskState(turn)}
                          className="ans"
                          onFollowUp={submit}
                          onFresh={fresh}
                          rescope={rescope}
                          foot={{
                            meta: turn.meta,
                            onRate: (f) => rate(turn.meta?.chatTurnId ?? null, f),
                            onFork: () => forkAt(t.id, turn.id),
                          }}
                        />
                      )
                    })}
                  </>
                )
              }
            </Section>
          ) : null}

          {shown.map((turn, i) => (
            <div key={turn.id} ref={i === shown.length - 1 ? newestRef : undefined} className="turn">
              {/* The question as the reader asked it, in the prototype's own
                  bubble. `useAsk` sends the scope sentence in front of it on
                  the wire; that plumbing is never shown back to the reader. */}
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
                className="ans"
                // Only the LAST turn's verdict is the page heading; an earlier
                // one still has to say its own point where it stands.
                verdictShownAbove={i === shown.length - 1}
                // A follow-up appends a turn here. In the palette the same
                // chip carries `data-askabout` and is caught by the one
                // document-level delegation — here that would open the palette
                // OVER this page and answer in it.
                onFollowUp={submit}
                onFresh={fresh}
                rescope={rescope}
                foot={{
                  meta: askAnswer(turn.state)?.meta ?? null,
                  liveDurationMs: i === shown.length - 1 ? liveMs : null,
                  onRate: (f) => rate(askAnswer(turn.state)?.meta?.chatTurnId ?? null, f),
                }}
              />
              )}
            </div>
          ))}

          {shown.length === 0 && !urlConversationId ? (
            /*
             * NOTHING ASKED YET — THE MORNING BRIEF ("Ask in Motion II", A).
             *
             * "Ask about Hollywood." over six department cards was a menu, and
             * a menu asks before it gives. The page now opens on the three
             * things that moved since the last visit, each with its figure and
             * each already phrased as the question to ask next; the six
             * starters survive as a chip row; the last four threads are the
             * same section the rail reads, so the two cannot disagree.
             */
            <div className="newask">
              <Section bare title="Since you were here" data={brief}>
                {(b) => (
                  <MorningBrief
                    greeting={headings.greeting}
                    since={
                      b.syncedAt
                        ? `${headings.since} · synced ${threadClock(new Date(b.syncedAt))}`
                        : headings.since
                    }
                    signals={b.signals}
                    onAsk={submit}
                  />
                )}
              </Section>
              <StarterChips starters={ASK_STARTERS} onAsk={submit} />
              <Section bare quietWhenEmpty title="Recent" data={sections.conversations}>
                {(items) =>
                  items.length === 0 ? null : (
                    <div className="recent">
                      <span className="k">Pick up where you left off</span>
                      {items.slice(0, 4).map((c) => (
                        <button type="button" key={c.id} onClick={() => openThread(c.id)}>
                          <b>{c.title ?? "Untitled"}</b>
                          <span>{threadTurnLabel(c.turns) || "1 turn"}</span>
                        </button>
                      ))}
                    </div>
                  )
                }
              </Section>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        * THE DOCK — ONE ROW. The composer with Quick / Careful, the mic and
        * send; the hints appear on focus. The scope row is gone (the head and
        * the placeholder name the scope) and so is the model tag. Sticky at
        * the bottom so the last answer never scrolls it away; the "New answer"
        * pill sits just above it.
        */}
      <div className="dock">
        <button
          type="button"
          className={`tobottom${showPill ? " on" : ""}`}
          aria-hidden={!showPill}
          tabIndex={showPill ? 0 : -1}
          onClick={() => {
            chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })
            setAwayFromBottom(false)
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
          New answer
        </button>
        <AskComposer
          // The prototype's "Ask a follow-up about this range…" is now honest —
          // a follow-up here IS a follow-up. Before the thread exists it names
          // the scope instead, which is what a first question is asked under.
          placeholder={
            shown.length > 0 || urlConversationId
              ? "Ask a follow-up…"
              : `Ask about ${context.store} · ${context.range}…`
          }
          onSubmit={submit}
          busy={askPending(state)}
          onStop={stop}
          effort={effort}
          onEffort={setEffort}
          mic
        />
      </div>
    </>
  )
}
