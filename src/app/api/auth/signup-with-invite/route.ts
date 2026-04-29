import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { rateLimit, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

const bodySchema = z.object({
  token: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200),
})

export async function POST(req: Request) {
  try {
    const limited = await rateLimit(req, RATE_LIMIT_TIERS.auth)
    if (limited) return limited

    const json = await req.json()
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }
    const { token, name, email, password } = parsed.data

    const hashedPassword = await bcrypt.hash(password, 10)

    try {
      const user = await prisma.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: { token },
          select: {
            id: true,
            accountId: true,
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

        const existing = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        })
        if (existing) throw new SignupError("An account with this email already exists", 409)

        const createdUser = await tx.user.create({
          data: {
            email,
            password: hashedPassword,
            name,
            role: "OWNER",
            accountId: invite.accountId,
          },
          select: { id: true, email: true },
        })

        await tx.invite.update({
          where: { id: invite.id },
          data: { usedAt: new Date(), usedByUserId: createdUser.id },
        })

        return createdUser
      })

      return NextResponse.json({ ok: true, userId: user.id }, { status: 201 })
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
