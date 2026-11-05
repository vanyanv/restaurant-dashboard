import type { InviteCheck } from "./invite"

/** What a link that cannot be used says, in the same words on desk and phone. */
export function noticeFor(check: Extract<InviteCheck, { ok: false }>): {
  headline: string
  body: string
  tone: "warn" | "ok"
  action: string
} {
  const who = check.inviterName ?? "whoever invited you"
  switch (check.reason) {
    case "expired":
      return {
        headline: "This link ran out",
        body: `Sign-up links work for 7 days. Ask ${who} for a fresh one; they can send it with one tap.`,
        tone: "warn",
        action: "Go to sign in",
      }
    case "revoked":
      return {
        headline: "This link was switched off",
        body: `A newer link was sent, or the invite was cancelled. Use the newest email from ${who}, or ask them for a fresh link.`,
        tone: "warn",
        action: "Go to sign in",
      }
    case "used":
      return {
        headline: "You already signed up",
        body: check.email
          ? `This link was already used. Sign in with ${check.email}. Forgot the password? Ask ${who} for a fresh link.`
          : `This link was already used. Sign in instead, or ask ${who} for a fresh link.`,
        tone: "ok",
        action: "Go to sign in",
      }
    default:
      return {
        headline: "We couldn't find that link",
        body: "It may be missing a few characters. Open it again from the email, or ask whoever invited you for a fresh one.",
        tone: "warn",
        action: "Go to sign in",
      }
  }
}
