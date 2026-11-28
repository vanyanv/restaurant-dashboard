/**
 * Which part of the app a request belongs to. The one mapping; the meter, the
 * roll-up and the Usage page all read sources from here.
 *
 * `tests/lib/usage/source.test.ts` walks every route in `src/app`, so a new
 * route cannot land in "other" unnoticed.
 */
export const USAGE_SOURCES = ["tv", "crew", "phone", "ask", "sync", "dashboard", "other"] as const
export type UsageSource = (typeof USAGE_SOURCES)[number]

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(prefix + "/")

function clean(pathname: string): string {
  const cut = pathname.search(/[?#]/)
  const path = cut >= 0 ? pathname.slice(0, cut) : pathname
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path
}

/** A page's source from its own path. */
function pageSource(path: string): UsageSource {
  if (under(path, "/dashboard/ask") || under(path, "/m/ask")) return "ask"
  if (under(path, "/tv")) return "tv"
  if (under(path, "/checks")) return "crew"
  if (under(path, "/m")) return "phone"
  if (under(path, "/dashboard")) return "dashboard"
  return "other"
}

function refererPath(referer: string | null | undefined): string | null {
  if (!referer) return null
  try {
    return clean(new URL(referer).pathname)
  } catch {
    return null
  }
}

/**
 * Path rules win. The referer is used only for an `/api/**` path with no rule
 * of its own: a call made from a page belongs to that page's source. A server
 * action needs no referer, because it is a POST to the page's own path.
 */
export function sourceOf(pathname: string, referer?: string | null): UsageSource {
  const path = clean(pathname)
  if (under(path, "/api/tv")) return "tv"
  if (under(path, "/api/checks")) return "crew"
  if (under(path, "/api/cron")) return "sync"
  if (under(path, "/api/chat") || under(path, "/api/ask")) return "ask"
  if (under(path, "/api/auth")) return "other"
  if (under(path, "/api")) {
    const from = refererPath(referer)
    const source = from ? pageSource(from) : "dashboard"
    return source === "other" ? "dashboard" : source
  }
  return pageSource(path)
}
