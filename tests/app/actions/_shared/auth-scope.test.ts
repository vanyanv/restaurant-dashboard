// resolveStoreScope characterizes the auth+store-resolution preamble that
// appears verbatim in many server actions: load all stores for the account,
// derive storeIds, optionally narrow to one storeId. The helper must NOT
// throw or shortcut on empty results — callers decide how to handle that.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { resolveStoreScope } from "@/app/actions/_shared/auth-scope"

const findMany = prisma.store.findMany as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  findMany.mockReset()
})

describe("resolveStoreScope", () => {
  it("returns null when session is null/missing user", async () => {
    const result = await resolveStoreScope(null, undefined)
    expect(result).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("returns null when there is a session but no user", async () => {
    // typed loosely on purpose — production code branches on session?.user
    const result = await resolveStoreScope({} as unknown as { user: undefined }, undefined)
    expect(result).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it("loads stores by accountId and returns all storeIds when no storeId is provided", async () => {
    findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }])

    const result = await resolveStoreScope(
      { user: { accountId: "acct-A", id: "u1" } },
      undefined
    )

    expect(findMany).toHaveBeenCalledWith({
      where: { accountId: "acct-A" },
      select: { id: true },
    })
    expect(result).toEqual({
      storeIds: ["s1", "s2", "s3"],
      targetStoreIds: ["s1", "s2", "s3"],
    })
  })

  it("narrows targetStoreIds to a single id when storeId is provided", async () => {
    findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }])

    const result = await resolveStoreScope(
      { user: { accountId: "acct-A", id: "u1" } },
      "s2"
    )

    expect(result).toEqual({
      storeIds: ["s1", "s2"],
      targetStoreIds: ["s2"],
    })
  })

  it("returns empty arrays (not null) when the account owns no stores — caller decides", async () => {
    findMany.mockResolvedValue([])

    const result = await resolveStoreScope(
      { user: { accountId: "acct-A", id: "u1" } },
      undefined
    )

    expect(result).toEqual({ storeIds: [], targetStoreIds: [] })
  })
})
