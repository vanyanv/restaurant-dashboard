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
  /** One line the reader can check BEFORE typing — note 43's actual fix. */
  sentence: string
}

export function describeAskContext({
  pathname,
  params,
  storeName,
  today,
}: {
  pathname: string
  params: URLSearchParams
  /** The selected store's display name, if the switcher's list has loaded. */
  storeName: string | null
  today: Date
}): AskContext {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => isActive(i, pathname))
  const page = item?.label ?? "Dashboard"

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

  return { page, store, range, sentence: `Answering about ${page} · ${store} · ${range}` }
}
