import { rangeLabel } from "./date-range"
import { readCounterParams } from "./url-state"
import { NAV_GROUPS, isActive } from "./nav"

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
}

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
  const items = NAV_GROUPS.flatMap((g) => g.items)
  const here = items.find((i) => isActive(i, pathname))
  const from = origin ? items.find((i) => isActive(i, origin)) : undefined

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

  return { page, store, range, askedFrom: from?.label ?? null, sentence }
}

/** The Counter Ask page. `nav.ts` has pointed here since the rail was built. */
export const ASK_ROUTE = "/dashboard/ask"

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
}: {
  question: string
  params: URLSearchParams
  /** The route the question is leaving. Null on Ask itself, where the origin
   *  already sits in `?asked=` and is carried through unchanged. */
  origin?: string | null
}): string {
  const out = new URLSearchParams()
  for (const key of SCOPE_KEYS) {
    const value = params.get(key)
    if (value) out.set(key, value)
  }

  const q = question.trim()
  if (q) out.set("q", q)

  const from = origin && origin !== ASK_ROUTE ? origin : params.get("asked")
  if (from) out.set("asked", from)

  const qs = out.toString()
  return qs ? `${ASK_ROUTE}?${qs}` : ASK_ROUTE
}
