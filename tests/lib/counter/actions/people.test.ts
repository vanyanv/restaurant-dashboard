// Admin > People actions. Pinned: only a developer gets through; every lookup
// pairs the client's id with the caller's accountId; a fresh link switches the
// old one off; the safety rails hold; a failed email still hands back a link.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/checks/email", () => ({ sendEmail: vi.fn(), escapeEmailHtml: (s: string) => s }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    invite: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/checks/email"
import { invitePerson, removeAccess, restoreAccess, sendFreshLink, setPersonRole, cancelInvite } from "@/lib/counter/actions/people"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const DEV = { user: { id: "u_dev", role: "DEVELOPER", accountId: "acc_1", name: "Vardan", email: "v@x.com" } }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_URL = "https://dash.example.com/"
  asMock(getServerSession).mockResolvedValue(DEV)
  asMock(prisma.$transaction).mockResolvedValue([])
  asMock(prisma.user.findFirst).mockResolvedValue(null)
  asMock(prisma.user.count).mockResolvedValue(2)
  asMock(sendEmail).mockResolvedValue({ ok: true })
})

describe("who may use People", () => {
  it("refuses an owner before touching the database", async () => {
    asMock(getServerSession).mockResolvedValue({ user: { ...DEV.user, role: "OWNER" } })
    const r = await invitePerson({ email: "a@b.com", role: "OWNER" })
    expect(r).toEqual({ ok: false, error: "Only a developer can change who has access" })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("refuses a signed-out caller", async () => {
    asMock(getServerSession).mockResolvedValue(null)
    expect((await removeAccess({ userId: "u_1" })).ok).toBe(false)
  })
})

describe("invitePerson", () => {
  it("emails a link made for that email and role, switching older links for it off", async () => {
    const r = await invitePerson({ name: "Ana Reyes", email: " Ana@Example.com ", role: "DEVELOPER" })
    expect(r).toEqual({ ok: true, message: "Invite emailed to Ana" })
    expect(asMock(prisma.invite.updateMany).mock.calls[0][0].where).toMatchObject({ accountId: "acc_1", email: "ana@example.com", usedAt: null, revokedAt: null })
    expect(asMock(prisma.invite.create).mock.calls[0][0].data).toMatchObject({ accountId: "acc_1", email: "ana@example.com", name: "Ana Reyes", role: "DEVELOPER", createdByUserId: "u_dev" })
    const sent = asMock(sendEmail).mock.calls[0][0]
    expect(sent.to).toEqual(["ana@example.com"])
    expect(sent.text).toMatch(/https:\/\/dash\.example\.com\/signup\/[A-Za-z0-9_-]{40,}/)
  })

  it("hands back the link instead of sending when asked to copy", async () => {
    const r = await invitePerson({ email: "a@b.com", role: "OWNER", send: false })
    expect(r.ok && r.link).toMatch(/\/signup\//)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("still hands back the link when the email fails", async () => {
    asMock(sendEmail).mockResolvedValue({ ok: false, reason: "Email isn't set up for the dashboard yet" })
    const r = await invitePerson({ email: "a@b.com", role: "OWNER" })
    expect(r.ok).toBe(true)
    expect(r.ok && r.message).toContain("Copy the link")
    expect(r.ok && r.link).toMatch(/\/signup\//)
  })

  it("refuses someone who already has access, or an account elsewhere", async () => {
    asMock(prisma.user.findFirst).mockResolvedValueOnce({ accountId: "acc_1", removedAt: null })
    expect(await invitePerson({ email: "a@b.com", role: "OWNER" })).toEqual({ ok: false, error: "That person already has access" })
    asMock(prisma.user.findFirst).mockResolvedValueOnce({ accountId: "acc_2", removedAt: null })
    expect((await invitePerson({ email: "a@b.com", role: "OWNER" })).ok).toBe(false)
  })

  it("re-invites someone whose access was removed", async () => {
    asMock(prisma.user.findFirst).mockResolvedValueOnce({ accountId: "acc_1", removedAt: new Date() })
    expect((await invitePerson({ email: "a@b.com", role: "OWNER" })).ok).toBe(true)
  })

  it("rejects a bad email in words", async () => {
    expect(await invitePerson({ email: "nope", role: "OWNER" })).toEqual({ ok: false, error: "That email doesn't look right" })
  })
})

describe("sendFreshLink and cancelInvite", () => {
  it("only reads the invite inside the caller's account", async () => {
    asMock(prisma.invite.findFirst).mockResolvedValue(null)
    const r = await sendFreshLink({ inviteId: "inv_other" })
    expect(r.ok).toBe(false)
    expect(asMock(prisma.invite.findFirst).mock.calls[0][0].where).toEqual({ id: "inv_other", accountId: "acc_1" })
  })

  it("makes a new link with the old invite's email, name and role", async () => {
    asMock(prisma.invite.findFirst).mockResolvedValue({ email: "luis@x.com", name: "Luis", role: "OWNER", usedAt: null })
    const r = await sendFreshLink({ inviteId: "inv_1" })
    expect(r).toEqual({ ok: true, message: "Fresh link emailed to Luis. The old one no longer works" })
    expect(asMock(prisma.invite.create).mock.calls[0][0].data).toMatchObject({ email: "luis@x.com", role: "OWNER" })
  })

  it("cancels every live link for that email", async () => {
    asMock(prisma.invite.findFirst).mockResolvedValue({ email: "luis@x.com", name: "Luis" })
    expect((await cancelInvite({ inviteId: "inv_1" })).ok).toBe(true)
    expect(asMock(prisma.invite.updateMany).mock.calls[0][0].where).toMatchObject({ accountId: "acc_1", email: "luis@x.com" })
  })
})

describe("removeAccess, restoreAccess, setPersonRole", () => {
  it("removes an owner and switches their open links off", async () => {
    asMock(prisma.user.findFirst).mockResolvedValue({ id: "u_sam", name: "Sam", email: "sam@x.com", role: "OWNER", removedAt: null })
    const r = await removeAccess({ userId: "u_sam" })
    expect(r).toEqual({ ok: true, message: "Sam's access removed. They're signed out" })
    expect(asMock(prisma.user.findFirst).mock.calls[0][0].where).toEqual({ id: "u_sam", accountId: "acc_1" })
    expect(asMock(prisma.user.update).mock.calls[0][0]).toMatchObject({ where: { id: "u_sam" }, data: { removedAt: expect.any(Date) } })
  })

  it("will not remove the caller", async () => {
    asMock(prisma.user.findFirst).mockResolvedValue({ id: "u_dev", name: "V", email: "v@x.com", role: "DEVELOPER", removedAt: null })
    expect((await removeAccess({ userId: "u_dev" })).ok).toBe(false)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("gives access back", async () => {
    asMock(prisma.user.findFirst).mockResolvedValue({ id: "u_sam", name: "Sam", email: "sam@x.com", removedAt: new Date() })
    expect(await restoreAccess({ userId: "u_sam" })).toEqual({ ok: true, message: "Sam has access again" })
    expect(asMock(prisma.user.update).mock.calls[0][0].data).toEqual({ removedAt: null })
  })

  it("won't demote the last developer", async () => {
    asMock(prisma.user.findFirst).mockResolvedValue({ id: "u_d2", name: "D", email: "d@x.com", role: "DEVELOPER" })
    asMock(prisma.user.count).mockResolvedValue(1)
    expect((await setPersonRole({ userId: "u_d2", role: "OWNER" })).ok).toBe(false)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
