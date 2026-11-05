// Removing someone on Admin > People has to end their session, and nothing
// else may: a database that does not answer keeps everyone signed in.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }))
vi.mock("@/lib/monitoring/login-audit", () => ({ recordLoginEvent: vi.fn() }))
vi.mock("@/lib/welcome", () => ({ extractFirstName: () => null, markSignIn: vi.fn(), markSignOut: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { authOptions } from "@/lib/auth"

const findUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>
const jwt = authOptions.callbacks!.jwt! as unknown as (a: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown>>
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: (c: unknown, r: unknown) => Promise<unknown> } }).options.authorize

beforeEach(() => vi.clearAllMocks())

describe("session check", () => {
  it("ends the session of someone whose access was removed", async () => {
    findUnique.mockResolvedValue({ role: "OWNER", accountId: "acc_1", removedAt: new Date() })
    await expect(jwt({ token: { id: "u_1", role: "OWNER", accountId: "acc_1" } })).rejects.toThrow("access_removed")
  })

  it("ends the session of someone whose row is gone", async () => {
    findUnique.mockResolvedValue(null)
    await expect(jwt({ token: { id: "u_1", role: "OWNER", accountId: "acc_1" } })).rejects.toThrow()
  })

  it("applies a role change at once", async () => {
    findUnique.mockResolvedValue({ role: "DEVELOPER", accountId: "acc_1", removedAt: null })
    const t = await jwt({ token: { id: "u_1", role: "OWNER", accountId: "acc_1" } })
    expect(t.role).toBe("DEVELOPER")
  })

  it("keeps the session when the database does not answer", async () => {
    findUnique.mockRejectedValue(new Error("Can't reach database server"))
    const t = await jwt({ token: { id: "u_1", role: "OWNER", accountId: "acc_1" } })
    expect(t).toMatchObject({ id: "u_1", role: "OWNER", accountId: "acc_1" })
  })
})

describe("sign-in", () => {
  it("refuses a removed person like a wrong password", async () => {
    findUnique.mockResolvedValue({ id: "u_1", email: "a@b.com", password: "x", removedAt: new Date() })
    expect(await authorize({ email: "a@b.com", password: "whatever" }, { headers: {} })).toBeNull()
  })
})
