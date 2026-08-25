import { PRESETS, type PresetId } from "./date-range"
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

  const rawRange = params.get("range")
  const preset = PRESETS.find((p) => p.id === (rawRange as PresetId))
  // Same default as the controls: yesterday, because an owner opening the
  // dashboard in the morning wants the day that finished.
  const range = preset?.name ?? "Yesterday"

  const storeId = params.get("store")
  const store = storeId ? (storeName ?? storeId) : "All stores"

  return { page, store, range, sentence: `Answering about ${page} · ${store} · ${range}` }
}
