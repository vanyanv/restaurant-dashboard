import { prisma } from "@/lib/prisma"

/**
 * One invite lookup, read by both surfaces.
 *
 * `/signup/<token>` and `/signup/phone/<token>` are the same decision made
 * twice, and an invite is the kind of record where "expired on the desk, live
 * on the phone" would be a real bug rather than a cosmetic one. The two pages
 * differ only in what they draw.
 */
export type InviteCheck =
  | {
      ok: true
      token: string
      /** Who the link is for. Null only on invites made before People existed. */
      email: string | null
      name: string | null
      role: "OWNER" | "DEVELOPER"
      accountName: string
      inviterName: string
      inviterEmail: string
      expiresAt: Date
    }
  | {
      ok: false
      reason: "missing" | "expired" | "used" | "revoked"
      inviterEmail?: string
      inviterName?: string
      email?: string | null
      tokenShort: string
    }

export async function checkInvite(token: string): Promise<InviteCheck> {
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: {
      token: true,
      email: true,
      name: true,
      role: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      account: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  })

  const tokenShort = shortToken(token)

  if (!invite) return { ok: false, reason: "missing", tokenShort }
  if (invite.revokedAt) {
    return {
      ok: false,
      reason: "revoked",
      inviterEmail: invite.createdBy.email,
      inviterName: invite.createdBy.name || invite.createdBy.email,
      email: invite.email,
      tokenShort,
    }
  }
  if (invite.usedAt) {
    return {
      ok: false,
      reason: "used",
      inviterEmail: invite.createdBy.email,
      inviterName: invite.createdBy.name || invite.createdBy.email,
      email: invite.email,
      tokenShort,
    }
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      reason: "expired",
      inviterEmail: invite.createdBy.email,
      inviterName: invite.createdBy.name || invite.createdBy.email,
      email: invite.email,
      tokenShort,
    }
  }

  return {
    ok: true,
    token: invite.token,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    accountName: invite.account.name,
    inviterName: invite.createdBy.name || invite.createdBy.email,
    inviterEmail: invite.createdBy.email,
    expiresAt: invite.expiresAt,
  }
}

/** The last six characters, so a refusal can be quoted without leaking a live token. */
function shortToken(token: string): string {
  if (token.length <= 6) return token.toUpperCase()
  return token.slice(-6).toUpperCase()
}
