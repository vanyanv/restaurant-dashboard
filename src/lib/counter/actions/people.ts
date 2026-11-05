"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { authOptions } from "@/lib/auth"
import { sendEmail } from "@/lib/checks/email"
import {
  firstName,
  inviteEmailContent,
  inviteExpiry,
  newInviteToken,
  normalizeEmail,
  removalBlocked,
  roleChangeBlocked,
  roleWords,
  type PersonRole,
} from "@/lib/people/invites"

/**
 * Admin > People: invite, re-send, cancel, remove, give back, change role.
 *
 * Every action starts at `requireDeveloper`, which reads the session, refuses
 * anyone who is not a DEVELOPER, and returns the `accountId` every query below
 * is filtered by. A row id from the client is never trusted on its own: each
 * lookup pairs it with that accountId.
 */

export type PeopleResult =
  | { ok: true; message: string; link?: string }
  | { ok: false; error: string }

const ROLE = z.enum(["OWNER", "DEVELOPER"])

class Refused extends Error {}

async function requireDeveloper(): Promise<{ userId: string; accountId: string; name: string }> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new Refused("You're signed out. Sign in again")
  if (session.user.role !== "DEVELOPER") throw new Refused("Only a developer can change who has access")
  return { userId: session.user.id, accountId: session.user.accountId, name: session.user.name || session.user.email }
}

function origin(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function linkFor(token: string): string {
  return `${origin()}/signup/${token}`
}

function done(message: string, link?: string): PeopleResult {
  revalidatePath("/dashboard/admin/people")
  revalidatePath("/m/admin/people")
  return link ? { ok: true, message, link } : { ok: true, message }
}

async function guard(fn: () => Promise<PeopleResult>): Promise<PeopleResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message }
    console.error("[people] action failed", err)
    return { ok: false, error: "That didn't save. Try again" }
  }
}

function activeDevelopers(accountId: string): Promise<number> {
  return prisma.user.count({ where: { accountId, role: "DEVELOPER", removedAt: null } })
}

/** Every live link for one email on this account, matched without regard to case. */
function liveInvitesFor(accountId: string, email: string) {
  return { accountId, email: { equals: email, mode: "insensitive" as const }, usedAt: null, revokedAt: null }
}

/**
 * Remove or demote someone without ever leaving the account with no
 * developer. The count is re-taken inside the same serializable transaction
 * as the change, so two developers removing each other at once cannot both
 * succeed.
 */
async function changeKeepingADeveloper(accountId: string, change: (tx: Tx) => Promise<unknown>): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await change(tx)
      const left = await tx.user.count({ where: { accountId, role: "DEVELOPER", removedAt: null } })
      if (left < 1) throw new Refused("They're the last developer. Make someone else a developer first")
    },
    { isolationLevel: "Serializable" },
  )
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Make a link for one person and, unless asked only for the link, email it.
 * Any live link for the same email on this account is switched off first, so
 * only the newest link ever works.
 */
async function issue(
  me: { userId: string; accountId: string; name: string },
  who: { email: string; name: string | null; role: PersonRole },
  send: boolean,
): Promise<{ link: string; sent: boolean; reason?: string }> {
  const token = newInviteToken()
  const expiresAt = inviteExpiry()
  await prisma.$transaction([
    prisma.invite.updateMany({
      where: liveInvitesFor(me.accountId, who.email),
      data: { revokedAt: new Date() },
    }),
    prisma.invite.create({
      data: {
        token,
        accountId: me.accountId,
        createdByUserId: me.userId,
        email: who.email,
        name: who.name,
        role: who.role,
        expiresAt,
      },
    }),
  ])
  const link = linkFor(token)
  if (!send) return { link, sent: false }
  const r = await sendEmail({
    to: [who.email],
    ...inviteEmailContent({ to: who.email, name: who.name, inviterName: me.name, role: who.role, link, expiresAt }),
  })
  return r.ok ? { link, sent: true } : { link, sent: false, reason: r.reason }
}

function sentMessage(name: string, r: { sent: boolean; reason?: string }, verb: string): string {
  if (r.sent) return `${verb} emailed to ${name}`
  return `${r.reason ?? "The email didn't go"}. Copy the link and text it to ${name}`
}

const InviteInput = z.object({
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().email("That email doesn't look right").max(254),
  role: ROLE,
  /** false: make the link and hand it back to copy, send nothing. */
  send: z.boolean().default(true),
})

export async function invitePerson(raw: z.input<typeof InviteInput>): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const parsed = InviteInput.safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the name and email" }
    const email = normalizeEmail(parsed.data.email)
    const name = parsed.data.name || null

    const existing = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { accountId: true, removedAt: true },
    })
    if (existing && existing.accountId !== me.accountId) return { ok: false, error: "That email already has an account somewhere else" }
    if (existing && existing.removedAt === null) return { ok: false, error: "That person already has access" }

    const r = await issue(me, { email, name, role: parsed.data.role }, parsed.data.send)
    const who = firstName(name, email)
    if (!parsed.data.send) return done(`Link made for ${who}. Copy it and text it`, r.link)
    return done(sentMessage(who, r, "Invite"), r.sent ? undefined : r.link)
  })
}

/** Re-send to someone who has not signed up: a new 7-day link, the old one off. */
export async function sendFreshLink(input: { inviteId: string; send?: boolean }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const old = await prisma.invite.findFirst({
      where: { id: input.inviteId, accountId: me.accountId },
      select: { email: true, name: true, role: true, usedAt: true },
    })
    if (!old || !old.email) return { ok: false, error: "That invite is gone. Invite them again" }
    if (old.usedAt) return { ok: false, error: "They already signed up" }
    const send = input.send ?? true
    const r = await issue(me, { email: old.email, name: old.name, role: old.role }, send)
    const who = firstName(old.name, old.email)
    if (!send) return done(`New link made for ${who}. The old one no longer works`, r.link)
    if (r.sent) return done(`Fresh link emailed to ${who}. The old one no longer works`)
    return done(sentMessage(who, r, "Fresh link"), r.link)
  })
}

export async function cancelInvite(input: { inviteId: string }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const inv = await prisma.invite.findFirst({
      where: { id: input.inviteId, accountId: me.accountId },
      select: { email: true, name: true },
    })
    if (!inv) return { ok: false, error: "That invite is gone already" }
    // An old link with no email is switched off on its own; otherwise every
    // live link for that person goes, so no older one keeps working.
    await prisma.invite.updateMany({
      where: inv.email ? liveInvitesFor(me.accountId, inv.email) : { id: input.inviteId, accountId: me.accountId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return done(`Invite for ${firstName(inv.name, inv.email ?? "them")} cancelled. Their link no longer works`)
  })
}

export async function removeAccess(input: { userId: string }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const target = await prisma.user.findFirst({
      where: { id: input.userId, accountId: me.accountId },
      select: { id: true, name: true, email: true, role: true, removedAt: true },
    })
    if (!target) return { ok: false, error: "That person isn't on this account" }
    const blocked = removalBlocked({ actorId: me.userId, target, activeDevelopers: await activeDevelopers(me.accountId) })
    if (blocked) return { ok: false, error: blocked }
    await changeKeepingADeveloper(me.accountId, async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { removedAt: new Date() } })
      await tx.invite.updateMany({ where: liveInvitesFor(me.accountId, target.email), data: { revokedAt: new Date() } })
    })
    return done(`${firstName(target.name, target.email)}'s access removed. They're signed out`)
  })
}

/** Undo, and "Give access back" later: same password, same role. */
export async function restoreAccess(input: { userId: string }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const target = await prisma.user.findFirst({
      where: { id: input.userId, accountId: me.accountId },
      select: { id: true, name: true, email: true, removedAt: true },
    })
    if (!target) return { ok: false, error: "That person isn't on this account" }
    if (target.removedAt === null) return done(`${firstName(target.name, target.email)} already has access`)
    // Back with their old password; a link sent while they were out would
    // otherwise let someone else holding it reset that password.
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { removedAt: null } }),
      prisma.invite.updateMany({ where: liveInvitesFor(me.accountId, target.email), data: { revokedAt: new Date() } }),
    ])
    return done(`${firstName(target.name, target.email)} has access again`)
  })
}

export async function setPersonRole(input: { userId: string; role: PersonRole }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const to = ROLE.parse(input.role)
    const target = await prisma.user.findFirst({
      where: { id: input.userId, accountId: me.accountId, removedAt: null },
      select: { id: true, name: true, email: true, role: true },
    })
    if (!target) return { ok: false, error: "That person isn't on this account" }
    const blocked = roleChangeBlocked({ actorId: me.userId, target, to, activeDevelopers: await activeDevelopers(me.accountId) })
    if (blocked) return { ok: false, error: blocked }
    await changeKeepingADeveloper(me.accountId, (tx) => tx.user.update({ where: { id: target.id }, data: { role: to } }))
    return done(`${firstName(target.name, target.email)} is now ${to === "DEVELOPER" ? "a" : "an"} ${roleWords(to)}. It applies right away`)
  })
}

/** The live link for a waiting invite, to copy. Makes a new one if it ran out. */
export async function copyInviteLink(input: { inviteId: string }): Promise<PeopleResult> {
  return guard(async () => {
    const me = await requireDeveloper()
    const inv = await prisma.invite.findFirst({
      where: { id: input.inviteId, accountId: me.accountId, usedAt: null, revokedAt: null },
      select: { token: true, expiresAt: true, email: true, name: true },
    })
    if (inv && inv.expiresAt.getTime() > Date.now()) {
      return { ok: true, message: `Link for ${firstName(inv.name, inv.email ?? "them")} copied`, link: linkFor(inv.token) }
    }
    return sendFreshLink({ inviteId: input.inviteId, send: false })
  })
}
