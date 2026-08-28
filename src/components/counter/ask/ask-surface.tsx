"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { Calendar, Store as StoreGlyph } from "lucide-react"
import { askHref, describeAskContext, type AskContext } from "@/lib/counter/ask-context"
import { NAV_GROUPS } from "@/lib/counter/nav"
import { PRESETS, type PresetId, type RangeId } from "@/lib/counter/date-range"
import { NAV_ICONS } from "@/components/counter/shell/nav-icons"
import { AskGlyph } from "@/components/counter/surface/ask-glyph"
import { AskAnswerPane } from "@/components/counter/ask/ask-answer"
import { askQuestion, type AskState } from "@/lib/counter/use-ask"
import type { SwitchableStore } from "@/components/counter/shell/store-switcher"

/**
 * The ⌘K palette — `cmdk()` at line 8664 of
 * `docs/counter/counter-prototype.html`, emitted class-for-class:
 *
 * ```
 * .cmdkwrap[data-cmdk][hidden]
 *   .cmdk[role=dialog][aria-modal][aria-label="Ask, or jump to anything"]
 *     .cmdk__in    {ask glyph}<input data-cmdq>
 *     .cmdk__ctx   Asking about <b>{page}</b><span>{store} · {range}</span>
 *     .cmdk__mid
 *       .cmdk__list[data-cmdlist]
 *         .cmdk__row[data-askfree][hidden]      the typed question itself
 *         .cmdk__k  Ask about {page}      → .cmdk__row[data-askabout] × n
 *         .cmdk__k  Go to                 → .cmdk__row × 17
 *         .cmdk__k  Switch store          → .cmdk__row × n
 *         .cmdk__k  Change the range      → .cmdk__row × 12
 *     .cmdk__foot  ↑↓ to move · ↵ to open · esc to close · Reading {range}
 * ```
 *
 * Note 46: two surfaces printed ⌘K and neither opened anything. Task 6 found
 * the second half of that defect — the palette had been mounted, but as
 * Tailwind utilities, so all 34 of the ported sheet's `.cmdk*` rules were
 * dead. Every class above is the sheet's; this file writes no CSS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PORTALS TO `document.body`, WITH THE MEASUREMENTS
 * ---------------------------------------------------------------------------
 *
 * `.cmdkwrap` is `position: absolute; inset: 0` (counter-components.css:1231)
 * — NOT `fixed`. In the prototype it is a child of `.frame`, which is
 * `position: relative`, so `inset: 0` means "the whole app". This application
 * has no `.frame`; what it has instead is a chain of containing blocks that
 * would each catch an absolutely positioned descendant:
 *
 *   - `.appwrap` is `position: relative` (counter-components.css:140).
 *     MEASURED at 1440×900 on /dashboard: an `inset:0` absolute probe inside
 *     `.screen` lands at top 48.25, left 212, 1228×851.75 — 212px of rail and
 *     48px of topbar left unscrimmed, and the dialog centred on the wrong box.
 *   - `.ct-root` is `container-type: inline-size`, which applies layout
 *     containment and therefore makes it a containing block for absolute AND
 *     fixed descendants. It is `h-dvh` and full width, so today it happens to
 *     coincide with the viewport — a coincidence, not a guarantee.
 *
 * Portalled to `document.body` there is no containing block above it at all,
 * so `inset: 0` resolves against the initial containing block. MEASURED, with
 * `.screenwrap` scrolled to its bottom first and the palette opened second:
 * `getBoundingClientRect()` = top 0, left 0, 1440×900, against a 1440×900
 * viewport. Exact, both themes, 1440 and 390.
 *
 * `absolute` behaves as `fixed` here for one structural reason, and it is worth
 * writing down: the DOCUMENT never scrolls. `AppShell`'s root is
 * `h-dvh … overflow-hidden` and `.screenwrap` is the only scroller
 * (`overflow-y:auto`), so `window.scrollY` is 0 and
 * `document.documentElement.scrollHeight` equals the viewport height. Measured:
 * `screenwrap.scrollTop 225 / 225`, `window.scrollY 0`, `docScrollHeight 900`.
 * If a future page ever lets the document itself scroll, this element would
 * scroll away with it and would need `position: fixed` — which is a change to
 * the sheet, not to this file.
 *
 * The wrap carries `ct-root` ALONGSIDE `cmdkwrap`, on the same element. The
 * alias layer that turns `--ct-*` into the `--surface` / `--line` / `--mono`
 * names every ported rule reads is declared on `.ct-root`
 * (counter-components.css:21), and a portal to `document.body` lands outside
 * the app's own `.ct-root`, where all 34 `.cmdk*` rules would resolve to
 * nothing. It cannot be a wrapping element instead: `.ct-root`'s
 * `container-type: inline-size` would make that wrapper a containing block of
 * auto height, collapsing an `inset:0` child to 0px. Both classes on one
 * element is the only arrangement that gives the palette the tokens without
 * giving it a containing block. `.cmdkwrap`'s scrim background wins over
 * `.ct-root`'s `background: var(--paper)` on source order (1231 > 69).
 *
 * ---------------------------------------------------------------------------
 * WHAT `hidden` IS DOING, EVERYWHERE
 * ---------------------------------------------------------------------------
 *
 * Four rules in the ported sheet are keyed to the `hidden` ATTRIBUTE —
 * `.cmdkwrap[hidden]`, `.cmdk__row[hidden]`, `.cmdk__k[hidden]`,
 * `.cmdk__pane[hidden],.cmdk__list[hidden]`. Conditional rendering would leave
 * all four dead, so the palette is mounted once and every filter decision is
 * an attribute, exactly as `cmdkFilter()` writes it. That also gives the two
 * entry animations (`cnfade` on the wrap, `cnrise` on the dialog) something to
 * replay: a `display:none` element runs no animation and starts fresh when it
 * is shown again.
 *
 * ---------------------------------------------------------------------------
 * ROWS COME FROM REAL DATA
 * ---------------------------------------------------------------------------
 *
 * "Go to" is `NAV_GROUPS` (`src/lib/counter/nav.ts`) — the same seventeen
 * destinations the rail draws, under the same icons (`NAV_ICONS`). "Switch
 * store" is the same `stores` array the rail's switcher gets. "Change the
 * range" is `PRESETS` from `date-range.ts`, the same twelve `DateControl`
 * offers. A palette that lists a page the rail does not is worse than one that
 * lists nothing, so none of these is written out here.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATE DIVERGENCES, EACH ONE RULED
 * ---------------------------------------------------------------------------
 *
 * 1. F-R10 — THE PRE-FILL, BUT ONLY INSIDE THIS PALETTE. The prototype's
 *    suggestion rows call `askAnywhere(q)`, which renders an answer and
 *    DISCARDS whatever was in the input. A row rendered INSIDE this surface —
 *    a suggestion under "Ask about {page}", or a follow-up chip in
 *    `AskAnswerPane`'s own `.sugs` — still only pre-fills: the reader is
 *    already looking at the input and gets to see and edit the question
 *    before it goes anywhere.
 *
 *    Everything ELSE carrying `data-askabout` — `Section`'s `.askmini` and
 *    `AskBar`'s opener and chips — lives out on the page, not in this
 *    surface, and Task 2 made those SUBMIT on click: clicking a button
 *    labelled "Ask about this" already is the decision, there is nothing left
 *    to confirm in an input the reader never asked to see. The one delegated
 *    `click` listener below tells the two apart with
 *    `askEl.closest('[data-cmdk]')` — true for anything painted inside this
 *    component's own portalled root, false for anything out on the page — and
 *    only ever calls `openSurface` (pre-fill) for the former, `openSurface`
 *    THEN `submit` for the latter. An empty carried question (`AskBar`'s bare
 *    opener, `data-askabout=""`) has nothing to submit, so it only opens,
 *    exactly as `⌘K` opening blank does.
 *
 *    No suggestion, chip or mini-button carries a click handler of its own —
 *    the document-level delegation below is still the one path in.
 *
 *    A CLICK ARRIVING OVER A TYPED-BUT-UNSUBMITTED QUESTION: `openSurface`
 *    has always reset the input on every open, including the plain `⌘K`
 *    re-open — that predates this task. A `.askmini`/`AskBar` click reuses
 *    that same reset, for the same reason: the palette that held the old
 *    draft was already CLOSED (its scrim covers the whole screen while open,
 *    so nothing under it is clickable), and closing an unsubmitted question
 *    without sending it is already how this surface treats a draft as
 *    abandoned. This task did not add a new way to lose a draft; it reused
 *    the existing one.
 * 2. `.cmdk__pane[data-cmdans]` ARRIVED WITH THE THING THAT FILLS IT. This
 *    entry used to record its absence: the prototype's pane renders
 *    `askRender()`, a keyword-scored lookup over invented answers, and an
 *    empty pane that is `hidden` forever is exactly the dead markup note 46 is
 *    about. The pane is now `AskAnswerPane`, driven by `useAsk()` against
 *    `POST /api/chat` — 116 real tools, a real `fileReturn`, and a "Read" row
 *    naming what the turn actually read (K-R2). It is rendered ONLY when a
 *    caller passes `askState`, so a mount with no answer surface wired still
 *    emits no pane at all and `onSubmit` behaves exactly as it did.
 *
 *    Three consequences, each deliberate:
 *      - Submitting no longer CLOSES the surface when there is a pane to fill.
 *        The answer takes the space the list was in, so the palette "never
 *        grows and never navigates" — `cmdkAnswer()`'s own comment.
 *      - The arrows and Enter go inert while the pane is up, as they do in
 *        `cmdkOpen`'s keydown (`if (!pane.hidden) return`). Marking a row
 *        nobody can see, and opening it on Enter, is the defect the mark reset
 *        below already guards against in the other direction.
 *      - Escape CLOSES the palette rather than stepping back to the list. The
 *        prototype makes Escape a two-stage back; here the answer is the thing
 *        a reader summoned and "Back to search" is a button in the foot, so
 *        one Escape means one thing everywhere in this application.
 *
 *    Reopening the surface (⌘K, or any `[data-askabout]` click) clears the
 *    answer. A palette that reopens onto last week's question would be showing
 *    a figure for a store and a range the reader may have changed since.
 *    F-R10 still holds through all of it: the answer is what gets cleared, and
 *    the TYPED QUESTION stays in the input.
 * 3. NO "OPEN A VIEW" GROUP. It is built from the prototype's `VIEWS` map of
 *    sub-tabs per page. `nav.ts` declares destinations and no sub-views, so
 *    the group would be a heading over nothing — which is the very thing
 *    `cmdkFilter()` hides. It arrives with the view model.
 * 4. "GO TO" ROWS ARE `<Link>`, NOT `<button data-goto>`. Same reasoning the
 *    rail already carries: a real href is middle-clickable and openable in a
 *    new tab, and every `.cmdk__row` rule is class-keyed so it applies to an
 *    `<a>` unchanged. Enter still activates them, because Enter clicks the
 *    marked row exactly as the prototype does.
 * 5. NO `<form>`. The prototype's input is a bare input and Enter activates
 *    the MARKED ROW; once three characters are typed the marked row is the
 *    free row, which is the question itself. Wrapping the input in a form
 *    would put an element inside `.cmdk__in` that `.cmdk__in input{flex:1}`
 *    does not expect.
 * 6. THE FREE ROW CARRIES NO `data-askabout`. In the prototype that attribute
 *    is how the free row reaches the answer pane. Here the document-level
 *    `[data-askabout]` listener would catch its own row and merely re-fill the
 *    input it came from, so the free row submits directly instead.
 */

/** One row of the list. Exactly one of `href` / `askAbout` / `onSelect` acts. */
interface PaletteRow {
  key: string
  /** The search key — lowercased label. Filtering matches THIS, not the rendered text. */
  dataT: string
  icon: ReactNode
  label: string
  hint: string
  href?: string
  askAbout?: string
  onSelect?: () => void
}

interface PaletteGroup {
  caption: string
  rows: PaletteRow[]
}

function Row({
  row,
  hidden,
  active,
  extraAttrs,
  onActivate,
}: {
  row: PaletteRow
  hidden: boolean
  active: boolean
  extraAttrs?: Record<string, string>
  onActivate: () => void
}) {
  const className = active ? "cmdk__row on" : "cmdk__row"
  const body = (
    <>
      {row.icon}
      <span>{row.label}</span>
      <span className="hint">{row.hint}</span>
    </>
  )

  if (row.href) {
    return (
      <Link
        className={className}
        href={row.href}
        hidden={hidden}
        data-t={row.dataT}
        onClick={onActivate}
      >
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={className}
      hidden={hidden}
      data-t={row.dataT}
      data-askabout={row.askAbout}
      onClick={onActivate}
      {...extraAttrs}
    >
      {body}
    </button>
  )
}

export function AskSurface({
  pathname,
  params,
  storeName,
  today,
  stores,
  selectedStoreId = null,
  onSelectStore,
  presetId,
  onSelectPreset,
  suggestions = [],
  onSubmit,
  askState,
  onAskBack,
}: {
  pathname: string
  params: URLSearchParams
  storeName: string | null
  today: Date
  /** The rail's own list — "Switch store" is drawn from it or not drawn at all. */
  stores?: SwitchableStore[]
  selectedStoreId?: string | null
  onSelectStore?: (id: string | null) => void
  /** Which preset is current, so its row reads "Current" rather than "Range". */
  presetId?: RangeId
  onSelectPreset?: (id: PresetId) => void
  /** "Ask about {page}" — the page's own suggested questions, or no group. */
  suggestions?: string[]
  onSubmit?: (question: string, context: AskContext) => void
  /** The lifecycle of the last submitted question. PRESENT is what turns this
   *  palette into an answering surface: absent, submitting closes it and hands
   *  the question to `onSubmit` alone, exactly as before. */
  askState?: AskState
  /** Throw the answer away and go back to the list. */
  onAskBack?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const [active, setActive] = useState(0)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // The element focused before ⌘K (or an "Ask about this" click) opened the
  // surface — a reader who summoned this mid-page should land back exactly
  // where they were, not at document.body.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // `open` read from listeners that are mounted once, for the life of the
  // component. State would be captured stale in those closures.
  const openRef = useRef(false)
  openRef.current = open
  // Same reason as `openRef`: the two listeners below are mounted once, and a
  // caller that passes an inline `onAskBack` would otherwise re-register both
  // on every render of the shell.
  const askBackRef = useRef(onAskBack)
  askBackRef.current = onAskBack

  const context = describeAskContext({ pathname, params, storeName, today })

  // Whether the pane is showing, which is also whether the list is not.
  const askStatus = askState?.status ?? "idle"
  const answering = askStatus !== "idle"
  const answeringRef = useRef(false)
  answeringRef.current = answering

  const close = useCallback(() => {
    setOpen(false)
    restoreFocusRef.current?.focus?.()
  }, [])

  const openSurface = useCallback((prefill: string) => {
    // Only the FIRST open captures where to go back to. A `[data-askabout]`
    // click while the palette is already open would otherwise record a row
    // inside the palette as the thing to restore focus to.
    if (!openRef.current) restoreFocusRef.current = document.activeElement as HTMLElement | null
    // Summoning the surface always lands on the list, never on the previous
    // question's answer — see divergence 2.
    if (answeringRef.current) askBackRef.current?.()
    setQuestion(prefill)
    setActive(0)
    setOpen(true)
  }, [])

  const submit = useCallback(
    (q: string) => {
      onSubmit?.(q, context)
      // With a pane to fill, the answer takes the space the list was in. With
      // no pane wired, the question has left this surface and there is nothing
      // left here to look at.
      if (askState === undefined) close()
    },
    [onSubmit, context, close, askState],
  )
  // The document-level `click` listener below is mounted ONCE (see its own
  // effect's empty-ish dep list) and would otherwise close over the `submit`
  // from that first render forever — stale `context`/`onSubmit`/`askState`
  // included. Same fix as `askBackRef` above, for the same reason.
  const submitRef = useRef(submit)
  submitRef.current = submit
  // Same stale-closure reason as `submitRef`: the delegation is mounted once.
  const askStateRef = useRef(askState)
  askStateRef.current = askState

  /* ---------------------------------------------------------------- rows */

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = []

    if (suggestions.length > 0) {
      out.push({
        // The prototype lowercases the page name in this one heading, because
        // `.cmdk__k` is already `text-transform: uppercase` and a name that
        // arrives capitalised reads as two different cases in the same line.
        caption: `Ask about ${context.page.toLowerCase()}`,
        rows: suggestions.map((q) => ({
          key: `ask:${q}`,
          dataT: q.toLowerCase(),
          icon: <AskGlyph />,
          label: q,
          hint: "Answer",
          askAbout: q,
        })),
      })
    }

    out.push({
      caption: "Go to",
      rows: NAV_GROUPS.flatMap((g) => g.items).map((item) => {
        const Icon = NAV_ICONS[item.icon]
        return {
          key: `go:${item.id}`,
          dataT: item.label.toLowerCase(),
          icon: Icon ? <Icon aria-hidden="true" /> : null,
          label: item.label,
          // The prototype's own hint: the route with `/dashboard` taken off,
          // which for Overview itself is the empty string.
          hint: item.href.replace("/dashboard", ""),
          href: item.href,
        }
      }),
    })

    if (stores && stores.length > 0 && onSelectStore) {
      out.push({
        caption: "Switch store",
        rows: [
          // The prototype's `STORES` carries an `all` pseudo-store — "All
          // stores · 3 locations" — and so does the rail's own switcher, as
          // its first option. A palette that could scope to one store but not
          // back out to all of them offers half the control the rail does.
          {
            key: "store:all",
            dataT: "all stores",
            icon: <StoreGlyph aria-hidden="true" />,
            label: "All stores",
            hint: `${stores.length} locations`,
            onSelect: () => onSelectStore(null),
          },
          ...stores.map((s) => ({
            key: `store:${s.id}`,
            dataT: s.name.toLowerCase(),
            icon: <StoreGlyph aria-hidden="true" />,
            label: s.name,
            // The prototype prints the store's own state here, and note 58's
            // three stages are what this application has to print.
            hint: STAGE_HINT[s.stage],
            onSelect: () => onSelectStore(s.id),
          })),
        ],
      })
    }

    if (onSelectPreset) {
      out.push({
        caption: "Change the range",
        rows: PRESETS.map((p) => ({
          key: `range:${p.id}`,
          dataT: p.name.toLowerCase(),
          icon: <Calendar aria-hidden="true" />,
          label: p.name,
          hint: p.id === presetId ? "Current" : "Range",
          onSelect: () => onSelectPreset(p.id),
        })),
      })
    }

    return out
  }, [suggestions, context.page, stores, onSelectStore, presetId, onSelectPreset])

  /* ------------------------------------------------------------ filtering */

  const raw = question.trim()
  const q = raw.toLowerCase()
  // The prototype's own threshold: the free row "only appears once there is
  // something to ask".
  const freeVisible = raw.length >= 3

  const visibleKeys = useMemo(() => {
    const keys: string[] = []
    if (freeVisible) keys.push("free")
    for (const g of groups) {
      for (const r of g.rows) {
        if (!q || r.dataT.includes(q)) keys.push(r.key)
      }
    }
    return keys
  }, [freeVisible, groups, q])

  // `cmdkMark(0)` after every filter: a mark left on a row the filter has
  // since hidden is a mark on something nobody can see, and Enter opened it.
  useEffect(() => {
    setActive(0)
  }, [q])

  const activeKey = visibleKeys.length > 0
    ? visibleKeys[((active % visibleKeys.length) + visibleKeys.length) % visibleKeys.length]
    : null

  const activateKey = useCallback(
    (key: string) => {
      if (key === "free") {
        submit(raw)
        return
      }
      for (const g of groups) {
        for (const r of g.rows) {
          if (r.key !== key) continue
          // A suggestion row does NOTHING here. Its `data-askabout` is caught
          // by the document-level delegation, which pre-fills the input
          // (F-R10) — closing it here would fight that on the way past.
          if (r.askAbout !== undefined) return
          // Everything else acts and closes: a `<Link>` row navigates through
          // its own click, a store or range row calls back first.
          r.onSelect?.()
          close()
          return
        }
      }
    },
    [groups, raw, submit, close],
  )

  /* ------------------------------------------------------- global wiring */

  // The portal host. Resolved in an effect so the first (server) render emits
  // nothing — `document` does not exist there.
  useEffect(() => setHost(document.body), [])

  // ⌘K / Ctrl+K opens the surface, from anywhere. Delegated `[data-askabout]`
  // clicks open it pre-filled. Both listeners are mounted once, for the life
  // of the component — a reader can summon the surface whether or not it is
  // already open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        // The prototype toggles: `cmdkOpen(w.hidden)`.
        if (openRef.current) close()
        else openSurface("")
      }
    }
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      const askEl = target?.closest("[data-askabout]")
      if (!askEl) return
      const value = askEl.getAttribute("data-askabout") ?? ""
      openSurface(value)
      // Divergence 1, above: a row painted INSIDE this palette's own portalled
      // root (a suggestion, or an `AskAnswerPane` follow-up chip) only
      // pre-fills. Everything else carrying `data-askabout` — `.askmini`,
      // `AskBar` — lives on the page and its click IS the ask, so it submits
      // too, unless there is nothing to submit (the ask bar's bare opener
      // carries `data-askabout=""`).
      //
      // AND ONLY WHEN ASK IS ACTUALLY WIRED. With no `askState`, `submit`
      // closes the surface (there is no pane for an answer to land in), so a
      // section click would open the palette and immediately throw the
      // question away — strictly worse than the pre-fill it replaced, and
      // invisible in the app because the shell always passes `askState`. An
      // unwired consumer keeps the old behaviour: the question lands in the
      // input and waits.
      const fromThisPalette = askEl.closest("[data-cmdk]") !== null
      const askWired = askStateRef.current !== undefined
      if (!fromThisPalette && askWired && value.trim().length > 0) {
        submitRef.current(value)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("click", onClick)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("click", onClick)
    }
  }, [close, openSurface])

  // Escape, the arrows, Enter and the Tab trap — only wired while open, same
  // pattern as DateControl's and StoreSwitcher's own popovers.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        return
      }
      // `cmdkOpen`'s own guard: `if (!w.querySelector('[data-cmdans]').hidden)
      // return`. The list is hidden behind the pane, so there is no row to
      // mark and Enter would re-ask the question that is already answered.
      // Tab keeps working — a modal that lets Tab walk out is not modal.
      if (answering && e.key !== "Tab") return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => i + 1)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => i - 1)
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        // `r.click()`, as the prototype does it: a row is activated the same
        // way whether a finger or the keyboard reached it, so a `<Link>` row
        // navigates through Next's own click handling either way.
        wrapRef.current?.querySelector<HTMLElement>(".cmdk__row.on")?.click()
        return
      }
      if (e.key === "Tab") {
        // A modal that lets Tab walk out onto the page behind it is not modal.
        const dialog = wrapRef.current?.querySelector<HTMLElement>(".cmdk")
        if (!dialog) return
        // `hidden` is how this palette filters, so a hidden row is out of the
        // tab order too. Tested against the ATTRIBUTE rather than
        // `offsetParent`, which jsdom reports null for on every element.
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>("input, button, a[href]"),
        ).filter((el) => !el.hidden && el.closest("[hidden]") === null)
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const current = document.activeElement
        if (e.shiftKey && (current === first || !dialog.contains(current))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (current === last || !dialog.contains(current))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, close, answering])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // `rows[k].scrollIntoView({block:'nearest'})` — the marked row is useless if
  // it is below the fold of a list that scrolls.
  useEffect(() => {
    if (!open) return
    wrapRef.current
      ?.querySelector<HTMLElement>(".cmdk__row.on")
      ?.scrollIntoView?.({ block: "nearest" })
  }, [open, activeKey])

  if (!host) return null

  /* ---------------------------------------------------------------- DOM */

  return createPortal(
    <div
      ref={wrapRef}
      className="ct-root cmdkwrap"
      data-cmdk
      hidden={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Ask, or jump to anything">
        <div className="cmdk__in">
          <AskGlyph />
          <input
            ref={inputRef}
            type="text"
            data-cmdq
            value={question}
            onChange={(e) => {
              // Typing IS searching. An answer left on screen while the input
              // says something else is an answer to a question nobody can see.
              if (answering) onAskBack?.()
              setQuestion(e.target.value)
            }}
            placeholder={`Ask about ${context.store}, or jump to anything…`}
            aria-label="Ask, or jump to anything"
          />
        </div>

        {/* Note 43's fix, in the prototype's own arrangement: the page on the
            left, the store and the range pushed to the right. All three come
            from `describeAskContext`, which reads the same pathname and search
            params the page itself rendered from — so this line cannot name a
            range or a store other than what is on screen. */}
        <div className="cmdk__ctx">
          Asking about <b>{context.page}</b>
          <span>
            {context.store} · {context.range}
          </span>
        </div>

        <div className="cmdk__mid">
          <div className="cmdk__list" data-cmdlist hidden={answering}>
            {/* "Anything you can type is a question, so the first row is always
                the question you actually typed — the list underneath is the
                shortcut, not the point." */}
            <Row
              row={{
                key: "free",
                dataT: q,
                icon: <AskGlyph />,
                label: raw,
                hint: "Answer",
              }}
              hidden={!freeVisible}
              active={activeKey === "free"}
              extraAttrs={{ "data-askfree": "" }}
              onActivate={() => activateKey("free")}
            />

            {groups.map((group) => {
              const rows = group.rows.map((r) => ({
                row: r,
                hidden: Boolean(q) && !r.dataT.includes(q),
              }))
              // "A group heading with nothing under it is a heading for nothing."
              const anyVisible = rows.some((r) => !r.hidden)
              return (
                <Fragment key={group.caption}>
                  <div className="cmdk__k" hidden={!anyVisible}>
                    {group.caption}
                  </div>
                  {rows.map(({ row, hidden }) => (
                    <Row
                      key={row.key}
                      row={row}
                      hidden={hidden}
                      active={activeKey === row.key}
                      onActivate={() => activateKey(row.key)}
                    />
                  ))}
                </Fragment>
              )
            })}
          </div>

          {/* Mounted only when a caller wired an answer surface — the pane is
              `hidden` between questions, which is what `.cmdk__pane[hidden]`
              is for, but it is never mounted with nothing that could ever
              fill it. */}
          {askState ? (
            <div className="cmdk__pane" data-cmdans hidden={!answering}>
              {answering ? (
                <AskAnswerPane
                  state={askState}
                  context={context}
                  /* The question and the window it was asked under, both in
                     the link — "Open in Ask" that opened an empty page under
                     the default range would be note 46's defect again: a
                     destination that does not hold what it promised. */
                  openHref={askHref({
                    question: askQuestion(askState),
                    params,
                    origin: pathname,
                  })}
                  onBack={() => onAskBack?.()}
                  onLeave={close}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="cmdk__foot">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
          {/* The prototype's own inline style, and it is load-bearing:
              `.cmdk__foot` is a flex row with no spacer element. */}
          <span style={{ marginLeft: "auto" }}>Reading {context.range}</span>
        </div>
      </div>
    </div>,
    host,
  )
}

/** `.hint` uppercases these itself; note 58's three stages, worded as the
 *  store switcher already words them. */
const STAGE_HINT: Record<SwitchableStore["stage"], string> = {
  trading: "Trading",
  warming_up: "Warming up",
  pre_open: "Pre-open",
}
