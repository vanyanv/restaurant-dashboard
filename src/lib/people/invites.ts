import { randomBytes } from "node:crypto"
import { escapeEmailHtml } from "@/lib/checks/email"

/**
 * Admin > People: the pure rules behind inviting, re-sending and removing.
 *
 * Kept free of Prisma so the rules a developer relies on (a link is good for
 * seven days, a fresh link replaces the old one, you cannot remove yourself
 * or the last developer) are tested without a database.
 */

export const INVITE_DAYS = 7
export const INVITE_TTL_MS = INVITE_DAYS * 24 * 60 * 60 * 1000

export type PersonRole = "OWNER" | "DEVELOPER"

/** 32 random bytes, URL-safe. The token is the whole secret, so it is long. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url")
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS)
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Where an invite stands, in the words the page uses. */
export type InviteState = "waiting" | "ran_out" | "used" | "cancelled"

export function inviteState(
  i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InviteState {
  if (i.usedAt) return "used"
  if (i.revokedAt) return "cancelled"
  if (i.expiresAt.getTime() <= now.getTime()) return "ran_out"
  return "waiting"
}

/** Whole days left on a live link, never below 1 while it still works. */
export function daysLeft(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000))
}

/**
 * Why a removal is refused, or null when it may go ahead. Removing yourself
 * would lock the page's only reader out mid-click; removing the last
 * developer would leave nobody who can open People to undo it.
 */
export function removalBlocked(input: {
  actorId: string
  target: { id: string; role: PersonRole; removedAt: Date | null }
  activeDevelopers: number
}): string | null {
  if (input.target.id === input.actorId) return "You can't remove your own access"
  if (input.target.removedAt) return "Their access is already removed"
  if (input.target.role === "DEVELOPER" && input.activeDevelopers <= 1) {
    return "They're the last developer. Make someone else a developer first"
  }
  return null
}

/** Same guard for switching a role: the last developer cannot be demoted. */
export function roleChangeBlocked(input: {
  actorId: string
  target: { id: string; role: PersonRole }
  to: PersonRole
  activeDevelopers: number
}): string | null {
  if (input.target.role === input.to) return null
  if (input.target.id === input.actorId) return "You can't change your own access"
  if (input.target.role === "DEVELOPER" && input.activeDevelopers <= 1) {
    return "They're the last developer. Make someone else a developer first"
  }
  return null
}

export function firstName(name: string | null | undefined, email: string): string {
  const n = (name ?? "").trim().split(/\s+/)[0]
  return n || email.split("@")[0]
}

export function roleWords(role: PersonRole): string {
  return role === "DEVELOPER" ? "Developer" : "Owner"
}

/** The email an invitee gets. One button, who sent it, when it stops working. */
export function inviteEmailContent(e: {
  to: string
  name: string | null
  inviterName: string
  role: PersonRole
  link: string
  expiresAt: Date
}): { subject: string; text: string; html: string } {
  const hi = e.name ? firstName(e.name, e.to) : null
  const until = e.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" })
  const sees =
    e.role === "DEVELOPER"
      ? "sales, costs and store checks for every store, plus the developer pages"
      : "sales, costs and store checks for every store"
  const subject = "You're invited to the Chris N Eddy's dashboard"
  const text = [
    hi ? `Hi ${hi},` : "Hi,",
    "",
    `${e.inviterName} invited you to the Chris N Eddy's dashboard. You'll be able to see ${sees}.`,
    "",
    `Set up your account: ${e.link}`,
    "",
    `This link is just for ${e.to} and works once. It stops working on ${until}.`,
    "If you weren't expecting this, you can ignore it.",
  ].join("\n")
  const x = escapeEmailHtml
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;max-width:520px">
<p style="font-size:18px;font-weight:bold;margin:0 0 16px">Chris N Eddy's</p>
<p style="font-size:24px;font-weight:bold;line-height:1.2;margin:0 0 14px">${x(e.inviterName)} invited you to the dashboard</p>
<p>${hi ? `Hi ${x(hi)}, y` : "Y"}ou'll be able to see ${x(sees)}. It takes about a minute to set up.</p>
<p style="margin:22px 0"><a href="${x(e.link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none;background-color:#B42318;color:#FFFFFF">Set up my account</a></p>
<p style="font-size:12px;opacity:.7">This link is just for ${x(e.to)} and works once. It stops working on ${x(until)}. If you weren't expecting this, you can ignore it.</p>
</div>`
  return { subject, text, html }
}
