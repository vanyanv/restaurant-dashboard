"use server"

import { randomBytes } from "node:crypto"
import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export type ActionResult<T = void> =
  | { success: true; data?: T; error?: never }
  | { success?: never; error: string; data?: never }

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function isLocalOnly(): boolean {
  return process.env.NODE_ENV !== "production"
}

function inviteUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000"
  return `${base.replace(/\/$/, "")}/signup/${token}`
}

export async function createInvite(): Promise<ActionResult<{ url: string; id: string }>> {
  if (!isLocalOnly()) return { error: "Invite creation is disabled in production" }

  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== "OWNER") return { error: "Unauthorized" }

  const token = randomBytes(32).toString("base64url")
  const invite = await prisma.invite.create({
    data: {
      token,
      accountId: session.user.accountId,
      createdByUserId: session.user.id,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
    select: { id: true, token: true },
  })

  revalidatePath("/dashboard/invites")
  return { success: true, data: { id: invite.id, url: inviteUrl(invite.token) } }
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  if (!isLocalOnly()) return { error: "Invite management is disabled in production" }

  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== "OWNER") return { error: "Unauthorized" }

  const result = await prisma.invite.updateMany({
    where: {
      id,
      accountId: session.user.accountId,
      revokedAt: null,
      usedAt: null,
    },
    data: { revokedAt: new Date() },
  })

  if (result.count === 0) {
    return { error: "Invite not found or already used/revoked" }
  }

  revalidatePath("/dashboard/invites")
  return { success: true }
}

export type InviteRow = {
  id: string
  url: string
  createdAt: Date
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
  usedByEmail: string | null
  status: "pending" | "used" | "revoked" | "expired"
}

export async function listInvites(): Promise<InviteRow[]> {
  if (!isLocalOnly()) return []

  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.role !== "OWNER") return []

  const rows = await prisma.invite.findMany({
    where: { accountId: session.user.accountId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      token: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      usedBy: { select: { email: true } },
    },
  })

  const now = Date.now()
  return rows.map((r) => {
    let status: InviteRow["status"] = "pending"
    if (r.revokedAt) status = "revoked"
    else if (r.usedAt) status = "used"
    else if (r.expiresAt.getTime() < now) status = "expired"

    return {
      id: r.id,
      url: inviteUrl(r.token),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt,
      revokedAt: r.revokedAt,
      usedByEmail: r.usedBy?.email ?? null,
      status,
    }
  })
}
