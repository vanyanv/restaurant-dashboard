// Contract tests for the shared auth helpers in src/lib/auth-scope.ts.
// getOwnerId / getSessionUser / requireOwnerStore replace private copies that
// were duplicated across server-action files; these tests pin the exact
// behavior of those copies (nullable vs throwing, error messages, accountId
// scoping of the store lookup).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
  hasOwnerAccess: (role: string | null | undefined) =>
    role === "OWNER" || role === "DEVELOPER",
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findFirst: vi.fn(),
    },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  getAuthScope,
  getSessionUser,
  requireOwnerStore,
} from "@/lib/auth-scope"

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>
const findFirst = prisma.store.findFirst as unknown as ReturnType<typeof vi.fn>

const user = {
  id: "user-1",
  email: "o@example.com",
  name: "Owner",
  firstName: "Owner",
  role: "OWNER",
  accountId: "acct-A",
}

beforeEach(() => {
  mockedSession.mockReset()
  findFirst.mockReset()
})

describe("getAuthScope", () => {
  it("returns ownerId+accountId when a session exists", async () => {
    mockedSession.mockResolvedValue({ user })
    expect(await getAuthScope()).toEqual({ ownerId: "user-1", accountId: "acct-A" })
  })

  it("returns null when there is no session", async () => {
    mockedSession.mockResolvedValue(null)
    expect(await getAuthScope()).toBeNull()
  })
})

describe("getSessionUser", () => {
  it("returns the full session user when a session exists", async () => {
    mockedSession.mockResolvedValue({ user })
    expect(await getSessionUser()).toEqual(user)
  })

  it("returns null when there is no session", async () => {
    mockedSession.mockResolvedValue(null)
    expect(await getSessionUser()).toBeNull()
  })
})

describe("requireOwnerStore", () => {
  it("throws Unauthorized when there is no session", async () => {
    mockedSession.mockResolvedValue(null)
    await expect(requireOwnerStore("s1")).rejects.toThrow("Unauthorized")
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("throws Forbidden when the role lacks owner access", async () => {
    mockedSession.mockResolvedValue({ user: { ...user, role: "MANAGER" } })
    await expect(requireOwnerStore("s1")).rejects.toThrow("Forbidden")
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("scopes the store lookup by id AND the session's accountId", async () => {
    mockedSession.mockResolvedValue({ user })
    findFirst.mockResolvedValue({ id: "s1", name: "Hollywood" })

    const store = await requireOwnerStore("s1")

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "s1", accountId: "acct-A" },
      select: { id: true, name: true },
    })
    expect(store).toEqual({ id: "s1", name: "Hollywood" })
  })

  it("throws Store not found when the store is not in the caller's account", async () => {
    mockedSession.mockResolvedValue({ user })
    findFirst.mockResolvedValue(null)
    await expect(requireOwnerStore("other-account-store")).rejects.toThrow(
      "Store not found"
    )
  })
})
