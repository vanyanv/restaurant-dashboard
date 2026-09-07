/**
 * One source an answer read, and the two pure helpers that build it.
 *
 * NO `"use client"` here, on purpose: `adapters/ask.ts` (server) rebuilds a
 * stored turn's Read row from `ToolCall.args`/`result` with these, and the
 * client's `ask-state.ts` re-exports them for the Ask surfaces. A helper that
 * both halves call has to live on neither side.
 */

/**
 * One source an answer read: what it was, what it was asked, and how fresh
 * the table behind it is.
 *
 * The proposal's "Read row", and the reason it is worth more than the tool
 * name alone: a reader who cannot see the parameters cannot tell an answer
 * about the right week from an answer about the wrong one, and Otter backfills
 * closed windows, so a figure with no `asOf` cannot be checked at all.
 */
export interface ToolRead {
  tool: string
  /** `store=Hollywood · days=30`, or null when the tool took no arguments. */
  params: string | null
  /** ISO stamp from the tool's own result, or null when it reports none. */
  asOf: string | null
}

/**
 * The tool's arguments as one short line.
 *
 * Deliberately lossy. This sits under an answer, not in a debugger: long
 * values are cut, objects and arrays are summarised rather than dumped, and
 * the whole line is capped. A Read row that wraps to four lines stops being
 * read at all.
 */
export function formatToolParams(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null
  const parts: string[] = []
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue
    let shown: string
    if (Array.isArray(v)) shown = `${v.length} item${v.length === 1 ? "" : "s"}`
    else if (typeof v === "object") shown = "…"
    else shown = String(v)
    if (shown.length > 24) shown = `${shown.slice(0, 23)}…`
    parts.push(`${k}=${shown}`)
    if (parts.length === 4) break
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

/** The `asOf` a tool attached to its own result, if it reported one. */
export function asOfFromOutput(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null
  const v = (output as Record<string, unknown>).asOf
  return typeof v === "string" ? v : null
}

