// A password change ends every other session; sign-in failures are counted
// per email as well as per address (2026-11-20).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, loginEvent: { create: vi.fn() } },
}))
vi.mock("@/lib/monitoring/login-audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/monitoring/login-audit")>()),
  recordLoginEvent: vi.fn(),
}))
vi.mock("@/lib/welcome", () => ({ extractFirstName: () => null, markSignIn: vi.fn(), markSignOut: vi.fn() }))
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (a: string, b: string) => a === b), hash: vi.fn(async () => "hashed-new") },
}))
vi.mock("@/lib/auth-scope", () => ({ getSession: vi.fn() }))
vi.mock("@/lib/session-token", () => ({ reissueSessionCookie: vi.fn(async () => true) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { authOptions, AUTH_THROTTLED } from "@/lib/auth"
import { issuedBeforePasswordChange, passwordChangeStamp } from "@/lib/password-change"
import { changePassword } from "@/app/actions/user-actions"
import { getSession } from "@/lib/auth-scope"
import { reissueSessionCookie } from "@/lib/session-token"
import { recordLoginEvent } from "@/lib/monitoring/login-audit"

const mocked = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>
const jwt = authOptions.callbacks!.jwt! as unknown as (a: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown>>
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: (c: unknown, r: unknown) => Promise<unknown> } }).options.authorize

beforeEach(() => vi.clearAllMocks())

describe("password change ends older sessions", () => {
  const changedAt = new Date("2026-11-20T18:00:00.000Z")
  const sec = (d: Date) => Math.floor(d.getTime() / 1000)

  it("refuses a token issued before the change", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ role: "OWNER", accountId: "a1", removedAt: null, passwordChangedAt: changedAt })
    await expect(jwt({ token: { id: "u1", role: "OWNER", accountId: "a1", iat: sec(changedAt) - 1 } })).rejects.toThrow("access_removed")
  })

  it("keeps a token issued at or after the change (the changer's re-issued cookie)", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ role: "OWNER", accountId: "a1", removedAt: null, passwordChangedAt: changedAt })
    const t = await jwt({ token: { id: "u1", role: "OWNER", accountId: "a1", iat: sec(changedAt) } })
    expect(t.id).toBe("u1")
  })

  it("never ends a session for someone who has not changed their password", async () => {
    mocked(prisma.user.findUnique).mockResolvedValue({ role: "OWNER", accountId: "a1", removedAt: null, passwordChangedAt: null })
    const t = await jwt({ token: { id: "u1", role: "OWNER", accountId: "a1", iat: 1 } })
    expect(t.id).toBe("u1")
  })

  it("stamps on a whole second, so the re-issued iat is never earlier", () => {
    const stamp = passwordChangeStamp(Date.parse("2026-11-20T18:00:00.900Z"))
    expect(stamp.toISOString()).toBe("2026-11-20T18:00:00.000Z")
    expect(issuedBeforePasswordChange(sec(stamp), stamp)).toBe(false)
    expect(issuedBeforePasswordChange(undefined, stamp)).toBe(true)
  })

  it("changePassword stamps the change and re-issues the changer's cookie", async () => {
    mocked(getSession).mockResolvedValue({ user: { id: "u1" } })
    mocked(prisma.user.findUnique).mockResolvedValue({ password: "old-password" })
    const form = new FormData()
    form.set("currentPassword", "old-password")
    form.set("newPassword", "new-password-1")
    form.set("confirmPassword", "new-password-1")
    expect(await changePassword(form)).toEqual({ success: true })
    const data = mocked(prisma.user.update).mock.calls[0][0].data
    expect(data.password).toBe("hashed-new")
    expect(data.passwordChangedAt).toBeInstanceOf(Date)
    expect(data.passwordChangedAt.getMilliseconds()).toBe(0)
    expect(reissueSessionCookie).toHaveBeenCalledTimes(1)
  })

  it("a wrong current password changes nothing and re-issues nothing", async () => {
    mocked(getSession).mockResolvedValue({ user: { id: "u1" } })
    mocked(prisma.user.findUnique).mockResolvedValue({ password: "old-password" })
    const form = new FormData()
    form.set("currentPassword", "nope")
    form.set("newPassword", "new-password-1")
    form.set("confirmPassword", "new-password-1")
    expect(await changePassword(form)).toEqual({ error: "Current password is incorrect" })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(reissueSessionCookie).not.toHaveBeenCalled()
  })
})

describe("sign-in is throttled per email and address", () => {
  const user = { id: "u9", email: "owner@x.com", name: "O", role: "OWNER", accountId: "a1", password: "right-password", removedAt: null }

  it("after 10 wrong passwords for one email, refuses even the right one, whatever the casing", async () => {
    mocked(prisma.user.findFirst).mockResolvedValue(user)
    for (let i = 0; i < 10; i++) {
      expect(await authorize({ email: "owner@x.com", password: `wrong-${i}` }, { headers: {} })).toBeNull()
    }
    await expect(authorize({ email: "  OWNER@x.com ", password: "right-password" }, { headers: {} })).rejects.toThrow(AUTH_THROTTLED)
    // The real owner on another address is untouched: a stranger cannot lock them out.
    expect(
      await authorize({ email: "owner@x.com", password: "right-password" }, { headers: { "x-forwarded-for": "203.0.113.7" } }),
    ).toMatchObject({ id: "u9" })
    // Another email is untouched.
    mocked(prisma.user.findFirst).mockResolvedValue({ ...user, id: "u10", email: "other@x.com", password: "pw-other" })
    expect(await authorize({ email: "other@x.com", password: "pw-other" }, { headers: {} })).toMatchObject({ id: "u10" })
  })

  it("counts failures for an email with no account too, so the refusal tells nobody which exist", async () => {
    mocked(prisma.user.findFirst).mockResolvedValue(null)
    for (let i = 0; i < 10; i++) {
      expect(await authorize({ email: "nobody@x.com", password: "x" }, { headers: {} })).toBeNull()
    }
    await expect(authorize({ email: "nobody@x.com", password: "x" }, { headers: {} })).rejects.toThrow(AUTH_THROTTLED)
  })

  it("a right password spends nothing", async () => {
    mocked(prisma.user.findFirst).mockResolvedValue({ ...user, email: "fine@x.com" })
    for (let i = 0; i < 15; i++) {
      expect(await authorize({ email: "fine@x.com", password: "right-password" }, { headers: {} })).toMatchObject({ id: "u9" })
    }
    expect(recordLoginEvent).toHaveBeenCalledTimes(15)
  })
})
