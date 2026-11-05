import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

const bodySchema = z.object({
  token: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10, "Use at least 10 characters").max(200),
})

export async function POST(req: Request) {
  try {
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.auth)
    if (limited) return limited

    const json = await req.json()
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 })
    }
    const { token, name, password } = parsed.data

    const hashedPassword = await bcrypt.hash(password, 10)

    try {
      const user = await prisma.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: { token },
          select: {
            id: true,
            accountId: true,
            email: true,
            role: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
          },
        })

        if (!invite) throw new SignupError("Invalid invite", 410)
        if (invite.revokedAt) throw new SignupError("This invite was revoked", 410)
        if (invite.usedAt) throw new SignupError("This invite has already been used", 410)
        if (invite.expiresAt.getTime() < Date.now()) {
          throw new SignupError("This invite has expired", 410)
        }
        // The invite says who it is for; the form cannot change that. Old
        // links made before People named an email are refused outright.
        if (!invite.email) throw new SignupError("This link no longer works. Ask for a new one", 410)
        const email = invite.email.trim().toLowerCase()

        // Claim the link first, conditionally: two tabs racing, or a cancel
        // or re-send landing mid-request, leaves exactly one winner and no
        // account made from a link that was switched off.
        const now = new Date()
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        })
        if (claimed.count !== 1) throw new SignupError("This link no longer works. Ask for a new one", 410)

        const existing = await tx.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, accountId: true, removedAt: true },
        })
        // Someone whose access was removed on this account and was invited
        // again gets their old row back, so what they entered before keeps
        // their name. Anyone else with this email already has an account.
        const revived = existing && existing.removedAt && existing.accountId === invite.accountId
        if (existing && !revived) throw new SignupError("An account with this email already exists. Sign in instead", 409)

        const createdUser = revived
          ? await tx.user.update({
              where: { id: existing.id },
              data: { password: hashedPassword, name, role: invite.role, removedAt: null },
              select: { id: true, email: true },
            })
          : await tx.user.create({
              data: {
                email,
                password: hashedPassword,
                name,
                role: invite.role,
                accountId: invite.accountId,
              },
              select: { id: true, email: true },
            })

        await tx.invite.update({
          where: { id: invite.id },
          data: { usedByUserId: createdUser.id },
        })

        return createdUser
      })

      return NextResponse.json({ ok: true, userId: user.id, email: user.email }, { status: 201 })
    } catch (err) {
      if (err instanceof SignupError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error("signup-with-invite error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

class SignupError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
