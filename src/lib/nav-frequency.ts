export const STORAGE_KEY = "dashboard:nav-frequency"
export const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_EVENTS_PER_PATH = 200
export const CHANGE_EVENT = "dashboard:nav-frequency:changed"

type FrequencyMap = Record<string, number[]>

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function readRaw(): FrequencyMap {
  if (!isBrowser()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FrequencyMap
    }
    return {}
  } catch {
    return {}
  }
}

function writeRaw(map: FrequencyMap): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // quota / serialization failure — silently drop
  }
}

function prune(map: FrequencyMap, now: number): FrequencyMap {
  const cutoff = now - WINDOW_MS
  const out: FrequencyMap = {}
  for (const [path, events] of Object.entries(map)) {
    const within = events.filter((t) => typeof t === "number" && t >= cutoff)
    if (within.length === 0) continue
    const capped = within.length > MAX_EVENTS_PER_PATH
      ? within.slice(-MAX_EVENTS_PER_PATH)
      : within
    out[path] = capped
  }
  return out
}

export function recordNavClick(pathname: string): void {
  if (!isBrowser() || !pathname) return
  const now = Date.now()
  const current = readRaw()
  const existing = Array.isArray(current[pathname]) ? current[pathname] : []
  const next = prune(
    { ...current, [pathname]: [...existing, now] },
    now
  )
  writeRaw(next)
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // no-op
  }
}

export type RankedEntry = {
  pathname: string
  count: number
  lastAt: number
}

export function getRanked(limit: number): RankedEntry[] {
  if (!isBrowser()) return []
  const now = Date.now()
  const pruned = prune(readRaw(), now)
  writeRaw(pruned)
  const entries: RankedEntry[] = Object.entries(pruned).map(([path, events]) => ({
    pathname: path,
    count: events.length,
    lastAt: events[events.length - 1] ?? 0,
  }))
  entries.sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt))
  return entries.slice(0, limit)
}
