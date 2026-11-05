import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn().mockResolvedValue(null), RATE_LIMIT_TIERS: { auth: {} } }))
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    invite: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/auth/signup-with-invite/route"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const LIVE = {
  id: "inv_1",
  accountId: "acc_1",
  email: "Ana@Example.com",
  role: "OWNER",
  expiresAt: new Date(Date.now() + 86_400_000),
  usedAt: null,
  revokedAt: null,
}
const post = (body: object) =>
  POST(new Request("http://x/api/auth/signup-with-invite", { method: "POST", body: JSON.stringify(body) }))
const BODY = { token: "tok_12345678", name: "Ana", password: "longenough1" }

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$transaction).mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
  asMock(prisma.invite.findUnique).mockResolvedValue(LIVE)
  asMock(prisma.invite.updateMany).mockResolvedValue({ count: 1 })
  asMock(prisma.user.findFirst).mockResolvedValue(null)
  asMock(prisma.user.create).mockResolvedValue({ id: "u_ana", email: "ana@example.com" })
})

describe("POST /api/auth/signup-with-invite", () => {
  it("claims the link, then makes the account with the invite's email and role", async () => {
    const res = await post({ ...BODY, email: "someone-else@x.com" })
    expect(res.status).toBe(201)
    expect(asMock(prisma.invite.updateMany).mock.calls[0][0].where).toMatchObject({ id: "inv_1", usedAt: null, revokedAt: null })
    expect(asMock(prisma.user.create).mock.calls[0][0].data).toMatchObject({ email: "ana@example.com", role: "OWNER", accountId: "acc_1" })
    expect(asMock(prisma.invite.update).mock.calls[0][0].data).toEqual({ usedByUserId: "u_ana" })
  })

  it("makes no account when the link was used or switched off mid-request", async () => {
    asMock(prisma.invite.updateMany).mockResolvedValue({ count: 0 })
    const res = await post(BODY)
    expect(res.status).toBe(410)
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it("refuses an old link that names no email", async () => {
    asMock(prisma.invite.findUnique).mockResolvedValue({ ...LIVE, email: null })
    const res = await post({ ...BODY, email: "anyone@x.com" })
    expect(res.status).toBe(410)
    expect(prisma.invite.updateMany).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })
})
