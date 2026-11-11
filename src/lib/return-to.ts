/**
 * Where to send someone after they sign in, and where the home-screen app
 * should reopen — "pick up where you left off".
 *
 * The proxy sends a signed-out visitor to `/login?callbackUrl=<page they
 * asked for>`; the login doors read it back through `safeReturnTo`. The value
 * arrives in a URL anyone can craft, so only a same-site path is accepted:
 * it must start with one `/` (not `//host` or `/\host`, which browsers treat
 * as another site), and it must not point back at a sign-in screen or an
 * API route. Anything else falls back to the door's own landing page.
 */
export const RETURN_TO_PARAM = "callbackUrl"

const NOT_A_PLACE = [/^\/login([/?#]|$)/, /^\/m\/login([/?#]|$)/, /^\/api([/?#]|$)/, /^\/signup([/?#]|$)/]

export function safeReturnTo(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback
  let value = raw.trim()
  // Accept a full URL on this origin too (next-auth writes absolute ones).
  if (/^https?:\/\//i.test(value) && typeof window !== "undefined") {
    try {
      const url = new URL(value)
      if (url.origin !== window.location.origin) return fallback
      value = url.pathname + url.search + url.hash
    } catch {
      return fallback
    }
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (/[\u0000-\u001f]/.test(value)) return fallback
  if (NOT_A_PLACE.some((re) => re.test(value))) return fallback
  return value
}

/** The login URL that brings the visitor back to `pathWithSearch` afterwards. */
export function loginPathFor(pathWithSearch: string): string {
  if (pathWithSearch === "/" || pathWithSearch === "/dashboard" || pathWithSearch === "/m") return "/login"
  return `/login?${RETURN_TO_PARAM}=${encodeURIComponent(pathWithSearch)}`
}
