/**
 * The query string of a redirect shim's request, ready to append to where it
 * sends the reader: "" when there is none, otherwise "?store=…&…".
 *
 * For the page-file fallbacks behind `src/proxy.ts`'s legacy map. The proxy
 * carries the query itself; this is the same rule for the case where the map
 * and the tree disagree and the page runs instead.
 */
export function carryQuery(sp: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") out.set(key, value)
  }
  const q = out.toString()
  return q ? `?${q}` : ""
}
