import { rangeLabel } from "./date-range"
import { readCounterParams } from "./url-state"
import { NAV_GROUPS, isActive, type NavId } from "./nav"
import { deskRouteFor } from "./route-shape"

/**
 * What a question is about — derived, never passed.
 *
 * Note 43: Ask was the longest-held page in the product (a 3m 31s median
 * against 1m 12s on Overview) and the only one of forty-five with no states, no
 * store and no range. It answered for a store you were not looking at.
 *
 * Deriving the context from the same route and search params the page itself
 * reads means the two cannot disagree. A caller cannot pass a stale store.
 */

export interface AskContext {
  page: string
  store: string
  range: string
  /**
   * The page the question was asked FROM, when the reader carried one with
   * them — `/dashboard/ask?asked=/dashboard/analytics` — and null otherwise.
   *
   * Distinct from `page`, which is what the CURRENT route is about. On every
   * other route the two are the same thing said twice; on Ask itself they are
   * not, and only this one can honestly finish the sentence "Asked from …".
   */
  askedFrom: string | null
  /** One line the reader can check BEFORE typing — note 43's actual fix. */
  sentence: string
  /**
   * The SUBJECT page as a stable id, or null when the question has no subject
   * (Ask reached from the rail, Settings, Monitoring).
   *
   * `page` above is a display label and belongs to the sentence a reader
   * reads. This is the same resolution keyed for a machine: it decides which
   * tool schemas the turn carries (`src/lib/chat/tool-groups.ts`). Keeping
   * them separate is the point — renaming "P&L" in the rail must not silently
   * change which tools a P&L question can reach.
   *
   * Null is not a failure. It means "no department was established", and the
   * route answers that with the full tool set rather than a guess.
   */
  pageId: NavId | null
}

/**
 * The store and the window ONE turn was answered under.
 *
 * The narrow, human half of `AskContext` — the two dimensions a reader can
 * move on the page after an answer is already on screen, and therefore the
 * two an answer has to be able to state for itself. See `scopeFromSentence`.
 */
export interface AskTurnScope {
  store: string
  range: string
}

/**
 * The scope back out of the sentence that carried it.
 *
 * `useAsk` sends `${context.sentence}.\n${question}`, and the route persists
 * the whole string — so the scope every past turn was answered under is
 * already in the database, in prose, at the head of its own user message. It
 * was being split off and thrown away (`questionFrom`).
 *
 * That matters because the alternative is a schema column, and this needs no
 * migration to be exact: what is recovered here is precisely what travelled.
 *
 * Both sentence forms end the same way — `… · {store} · {range}` with or
 * without a leading page — so the last two segments are the answer to both,
 * and a string shaped like neither returns null rather than a guess.
 */
export function scopeFromSentence(sentence: string): AskTurnScope | null {
  const line = sentence.trim().replace(/\.$/, "")
  if (!line.startsWith("Answering about ")) return null
  const parts = line.split(" · ").map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const range = parts[parts.length - 1]
  const store = parts[parts.length - 2].replace(/^Answering about /, "")
  return store && range ? { store, range } : null
}

/**
 * The scope a question carries to `/api/chat`, as data rather than prose.
 *
 * Deliberately the narrow half of `AskContext`: the sentence, the store name
 * and the range label are all things the model reads as text and already
 * travel prepended to the question. What the ROUTE needs is the one field it
 * can branch on, and sending only that keeps the wire contract from drifting
 * into a second copy of the context.
 *
 * Every field is optional and untrusted — it arrives off a request body. The
 * route matches `pageId` against its own map and falls back to the full tool
 * set on anything it does not recognise.
 */
export interface AskRequestScope {
  pageId: NavId | null
  /**
   * The dock's Quick / Careful choice. `careful` lifts the model's reasoning
   * effort for this one turn; absent or `quick` leaves the route's default.
   */
  effort?: AskEffort
  /**
   * "Re-ask fresh" — skip the answer cache for this turn. The reader saw the
   * cached answer and asked for the model on purpose, so a hit is not wanted.
   */
  fresh?: boolean
}

/** How hard the model is asked to think on one turn. */
export type AskEffort = "quick" | "careful"

/** What the dock offers beside the field, and the seconds each one costs. */
export const ASK_EFFORTS: ReadonlyArray<{ id: AskEffort; label: string; hint: string }> = [
  { id: "quick", label: "Quick", hint: "Quick · about 5s" },
  { id: "careful", label: "Careful", hint: "Careful · about 20s · thinks longer" },
]

export function describeAskContext({
  pathname,
  params,
  storeName,
  today,
  origin = null,
}: {
  pathname: string
  params: URLSearchParams
  /** The selected store's display name, if the switcher's list has loaded. */
  storeName: string | null
  today: Date
  /**
   * The pathname a question travelled FROM, for `/dashboard/ask`, which is the
   * one route whose own name is not a subject. UNTRUSTED — it arrives off the
   * query string — but it is only ever matched against `NAV_GROUPS`, so what
   * comes out is a label from our own list or nothing at all.
   */
  origin?: string | null
}): AskContext {
  /*
   * BOTH SURFACES RESOLVE THROUGH THE DESK'S ROUTE STRINGS. `NAV_GROUPS` is
   * the desk rail's own list, so `/m/analytics` matches nothing in it and the
   * phone's questions would all have travelled subjectless. `deskRouteFor` is
   * the middleware's mapping read backwards; a phone path with no desk twin
   * comes back as a non-destination and resolves to nothing, which is the
   * same outcome as before rather than a guess.
   */
  const items = NAV_GROUPS.flatMap((g) => g.items)
  const here = items.find((i) => isActive(i, deskRouteFor(pathname)))
  const from = origin ? items.find((i) => isActive(i, deskRouteFor(origin))) : undefined

  /*
   * THE ASK PAGE IS NOT A SUBJECT.
   *
   * `sentence` is prepended to the question the model is asked (K-R1), so
   * every word in it is a claim about what is being answered. "Answering
   * about Ask · Hollywood · Aug 20 – Aug 26" names a department that does not
   * exist and invites the model to look for one. A reader who arrived on
   * `/dashboard/ask` from Analytics carries that page in `?asked=`, and it
   * becomes the subject; a reader who came from the rail brought no subject,
   * so the question is about the store and the window, and the sentence says
   * exactly that and nothing more.
   */
  const resolved = from ?? here
  const subject = resolved && resolved.id !== "ask" ? resolved : undefined
  const page = subject?.label ?? (resolved ? "everything" : "Dashboard")

  /*
   * THE RANGE COMES FROM `readCounterParams`, THE SAME READER THE PAGE USES.
   *
   * This used to look up `params.get("range")` against `PRESETS` and fall back
   * to "Yesterday" — which is right for a preset and silently wrong for a
   * custom window. `from`/`to` beat `range` everywhere else in the product
   * (they are the more specific statement), so a reader looking at
   * `?from=2026-08-20&to=2026-08-26` was told the palette was answering about
   * "Yesterday".
   *
   * That is not cosmetic. This sentence is prepended to the question Ask is
   * asked (ruling K-R1), so the scope did travel — it travelled WRONG, and the
   * answer would have been about a day the reader was not looking at. Note 43
   * exists because Ask once "answered for a store you were not looking at";
   * this was the same defect in the other dimension.
   */
  const { range: window, presetId } = readCounterParams(params, today)
  const range = rangeLabel(window, presetId)

  const storeId = params.get("store")
  const store = storeId ? (storeName ?? storeId) : "All stores"

  // No subject and no route match at all keeps the old "Dashboard" wording —
  // the only route that loses its subject is Ask, deliberately.
  const sentence =
    subject || !resolved
      ? `Answering about ${page} · ${store} · ${range}`
      : `Answering about ${store} · ${range}`

  return {
    page,
    store,
    range,
    askedFrom: from?.label ?? null,
    sentence,
    pageId: subject?.id ?? null,
  }
}

/** The Counter Ask page. `nav.ts` has pointed here since the rail was built. */
export const ASK_ROUTE = "/dashboard/ask"

/**
 * The same page on the phone. `src/proxy.ts` redirects `/dashboard/ask`
 * here on a phone user agent, so this is what a phone actually renders — and
 * a link BUILT on the phone points straight at it rather than paying for the
 * redirect hop, exactly as `/m`'s own links do.
 */
export const ASK_PHONE_ROUTE = "/m/ask"

/** Either surface of Ask. A question never records Ask itself as its origin. */
function isAskRoute(pathname: string): boolean {
  return pathname === ASK_ROUTE || pathname === ASK_PHONE_ROUTE
}

/**
 * The six questions Ask opens with, on both surfaces — one per department.
 *
 * Module-level and shared so the desk's empty state, the phone's, and the
 * ⌘K palette's "Ask about" group offer the same six, and phrased as questions
 * this backend can actually answer: each names a department the tools cover,
 * rather than advertising an ability the model would have to refuse (K-R3).
 * The department is the mock's `.starter .k` caption; it is not sent.
 */
export const ASK_STARTERS = [
  { dept: "P&L", q: "Why is food cost where it is?" },
  { dept: "Sales", q: "Which channel is costing the most to sell through?" },
  { dept: "Forecast", q: "What should I prep for Saturday?" },
  { dept: "Invoices", q: "Which invoices do not reconcile?" },
  { dept: "Ingredients", q: "Has any ingredient price moved this month?" },
  { dept: "Inventory", q: "What is on hand that I should count today?" },
] as const

/**
 * The query keys that describe WHAT is being answered, and the only ones that
 * travel to Ask.
 *
 * An allowlist rather than a denylist: the palette can be opened from the
 * orders list, whose `q` is a free-text SEARCH and whose `channels` are a
 * filter on that one table. Carrying those to Ask would put a search term in
 * the slot the question occupies and a filter on a page that has no list to
 * filter. Scope is the store, the window and what the window is compared
 * against — the three things `describeAskContext` reads back out.
 */
const SCOPE_KEYS = ["store", "range", "from", "to", "cmp"] as const

/**
 * Where a question goes to become a link — `/dashboard/ask?q=…`, carrying the
 * scope it was asked under and the page it was asked from.
 *
 * ONE builder, used by the palette's "Open in Ask" and by the Ask page's own
 * composer, so a question that moves between the two surfaces cannot arrive
 * under a different window than the one it was answered for.
 *
 * `asked` is the origin PATHNAME, not a nav id: `describeAskContext` resolves
 * it through `isActive` exactly as it resolves the current route, so a stale
 * or hand-typed value resolves to nothing rather than to the wrong page.
 */
export function askHref({
  question,
  params,
  origin = null,
  route = ASK_ROUTE,
}: {
  question: string
  params: URLSearchParams
  /** The route the question is leaving. Null on Ask itself, where the origin
   *  already sits in `?asked=` and is carried through unchanged. */
  origin?: string | null
  /**
   * WHICH Ask. The desk's by default; `ASK_PHONE_ROUTE` from anything under
   * `/m`, because the phone shell is what a phone reader is standing in and
   * `/dashboard/ask` would only bounce them back here through the middleware.
   * The query string either takes is identical — one builder, two doors.
   */
  route?: string
}): string {
  const out = new URLSearchParams()
  for (const key of SCOPE_KEYS) {
    const value = params.get(key)
    if (value) out.set(key, value)
  }

  const q = question.trim()
  if (q) out.set("q", q)

  const from = origin && !isAskRoute(origin) ? origin : params.get("asked")
  if (from) out.set("asked", from)

  const qs = out.toString()
  return qs ? `${route}?${qs}` : route
}
