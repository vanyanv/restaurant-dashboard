// Branching a thread. The point is to try a different direction from a given
// answer without losing the thread you already have, so the contract is: copy
// everything up to and including the chosen turn, nothing after it, and never
// across an account boundary.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { forkConversation, ConversationAccessError } from "@/lib/chat/conversation"

const findUnique = vi.fn()
const create = vi.fn()
const update = vi.fn()
const messageCreate = vi.fn()

const prisma = {
  conversation: { findUnique, create, update },
  message: { create: messageCreate },
} as never

const msg = (id: string, role: string, content: string) => ({
  id,
  role,
  content,
  createdAt: new Date("2026-08-19T00:00:00Z"),
  toolCalls: [],
})

const SOURCE = {
  id: "conv-1",
  accountId: "acct-1",
  title: "Sales, week of Aug 11",
  createdAt: new Date("2026-08-18T00:00:00Z"),
  updatedAt: new Date("2026-08-19T00:00:00Z"),
  _count: { messages: 4 },
  messages: [
    msg("m1", "user", "How were sales last week?"),
    msg("m2", "assistant", "Sales ran ahead of the week before."),
    msg("m3", "user", "Break that out by platform"),
    msg("m4", "assistant", "DoorDash carried 38%."),
  ],
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(SOURCE)
  create.mockReset().mockResolvedValue({ id: "conv-2" })
  update.mockReset().mockResolvedValue({})
  messageCreate.mockReset().mockResolvedValue({ id: "new" })
})

describe("forkConversation", () => {
  it("returns the new conversation's id", async () => {
    const { id } = await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    expect(id).toBe("conv-2")
  })

  it("copies only the turns up to and including the chosen one", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    const copied = messageCreate.mock.calls.map((c) => c[0].data.content)
    expect(copied).toEqual([
      "How were sales last week?",
      "Sales ran ahead of the week before.",
    ])
  })

  it("keeps roles and order intact", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m4")
    const roles = messageCreate.mock.calls.map((c) => c[0].data.role)
    expect(roles).toEqual(["user", "assistant", "user", "assistant"])
  })

  it("writes the copies into the new conversation, not the source", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    for (const call of messageCreate.mock.calls) {
      expect(call[0].data.conversationId).toBe("conv-2")
    }
  })

  it("creates the branch under the caller's own owner and account", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    expect(create.mock.calls[0][0].data).toMatchObject({
      ownerId: "owner-1",
      accountId: "acct-1",
    })
  })

  it("names the branch after its source so the rail stays readable", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    expect(update).toHaveBeenCalled()
    const titled = update.mock.calls.find((c) => c[0].data?.title)
    expect(titled?.[0].data.title).toBe("Sales, week of Aug 11 (branch)")
  })

  it("refuses a conversation on another account", async () => {
    findUnique.mockResolvedValue({ ...SOURCE, accountId: "acct-other" })
    await expect(
      forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2"),
    ).rejects.toBeInstanceOf(ConversationAccessError)
    expect(create).not.toHaveBeenCalled()
  })

  it("refuses when the chosen turn is not in the thread", async () => {
    await expect(
      forkConversation(prisma, "owner-1", "acct-1", "conv-1", "does-not-exist"),
    ).rejects.toBeInstanceOf(ConversationAccessError)
    expect(create).not.toHaveBeenCalled()
  })

  it("does not touch the source conversation's messages", async () => {
    await forkConversation(prisma, "owner-1", "acct-1", "conv-1", "m2")
    const wroteToSource = messageCreate.mock.calls.some(
      (c) => c[0].data.conversationId === "conv-1",
    )
    expect(wroteToSource).toBe(false)
  })
})
