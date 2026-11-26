import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { screenEvent: { create: vi.fn(async () => ({ id: "e1" })), findFirst: vi.fn() } },
}))
vi.mock("@/lib/prisma", () => ({ prisma }))

import { noteCodeShown, recordScreenEvent, tvTag } from "@/lib/screens/events"
import { cleanDevice } from "@/lib/screens/core"

const HASH = "abcdef0123456789".repeat(4)

beforeEach(() => vi.clearAllMocks())

describe("screen events", () => {
  it("keeps only a short tag of the token hash", async () => {
    await recordScreenEvent({ kind: "unpaired", tokenHash: HASH, accountId: "acc1", screenName: "Left" })
    expect(prisma.screenEvent.create).toHaveBeenCalledWith({
      data: { kind: "unpaired", tv: "abcdef012345", accountId: "acc1", screenName: "Left", storeId: null, device: null, userId: null },
      select: { id: true },
    })
    expect(tvTag(HASH)).toHaveLength(12)
  })

  it("never throws when the record can't be written", async () => {
    prisma.screenEvent.create.mockRejectedValueOnce(new Error("db down"))
    await expect(recordScreenEvent({ kind: "paired", tokenHash: HASH })).resolves.toBeUndefined()
  })

  it("records a code only for a TV that was paired before", async () => {
    prisma.screenEvent.findFirst.mockResolvedValueOnce(null)
    await noteCodeShown(HASH, "Tizen 7.0 · 1920x1080")
    expect(prisma.screenEvent.create).not.toHaveBeenCalled()

    prisma.screenEvent.findFirst.mockResolvedValueOnce({ accountId: "acc1", screenName: "Left", storeId: "s1" })
    await noteCodeShown(HASH, "Tizen 7.0 · 1920x1080")
    expect(prisma.screenEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "code", tv: "abcdef012345", accountId: "acc1", screenName: "Left", storeId: "s1" }) }),
    )
  })
})

describe("cleanDevice", () => {
  it("puts a mangled separator back as one dot", () => {
    expect(cleanDevice("Tizen 7.0 Â· 1920x1080")).toBe("Tizen 7.0 · 1920x1080")
    expect(cleanDevice("Tizen 7.0 � 1920x1080")).toBe("Tizen 7.0 · 1920x1080")
    expect(cleanDevice("Tizen 7.0 · 1920x1080")).toBe("Tizen 7.0 · 1920x1080")
  })
  it("is null for nothing, and stays short", () => {
    expect(cleanDevice(null)).toBeNull()
    expect(cleanDevice("   ")).toBeNull()
    expect(cleanDevice("x".repeat(300))).toHaveLength(120)
  })
})
