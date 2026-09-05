/**
 * What a thumbs-down asks, and what a thumb writes.
 *
 * `ChatTurn.feedback` has existed since the table did and has been null on
 * every row — the column was there, the button was not. A plain module, not
 * the `"use server"` action file, so the footer can import the reason list
 * and the type without pulling a server module across the boundary.
 *
 * The value IS what gets stored: `up`, or `down:<reason>`. One word each, so
 * the monitoring queries can group on it without parsing prose.
 */
export const ASK_DOWN_REASONS = [
  { code: "down:number", label: "Wrong number", hint: "a figure does not match a page" },
  { code: "down:scope", label: "Wrong scope", hint: "answered a different store or week" },
  { code: "down:refused", label: "Refused wrongly", hint: "it could have answered" },
  { code: "down:slow", label: "Too slow", hint: "right, but not worth the wait" },
] as const

export type AskFeedback = "up" | (typeof ASK_DOWN_REASONS)[number]["code"]

export function isAskFeedback(v: unknown): v is AskFeedback {
  return v === "up" || ASK_DOWN_REASONS.some((r) => r.code === v)
}

/** The short form the footer prints after a thumb lands: "Noted · wrong scope". */
export function askFeedbackLabel(code: string | null): string | null {
  if (!code) return null
  if (code === "up") return "Noted"
  const r = ASK_DOWN_REASONS.find((x) => x.code === code)
  return r ? `Noted · ${r.label.toLowerCase()}` : null
}
