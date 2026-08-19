// Thread search. The failure this exists to avoid is the one every write-up
// names in ChatGPT: past a few dozen threads you can only search titles, and
// titles are auto-generated, so the thread you remember by its numbers becomes
// unfindable. The where-clause shape IS the feature, so it is pinned here.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchConversations } from "@/lib/chat/conversation"

const findMany = vi.fn()
const prisma = { conversation: { findMany } } as never

const row = (id: string, title: string | null) => ({
  id,
  title,
  createdAt: new Date("2026-08-18T00:00:00Z"),
  updatedAt: new Date("2026-08-19T00:00:00Z"),
  _count: { messages: 4 },
})

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([row("c1", "Sales, week of Aug 11")])
})

describe("searchConversations", () => {
  it("scopes every query to the account", async () => {
    await searchConversations(prisma, "acct-1", "produce")
    expect(findMany.mock.calls[0][0].where.accountId).toBe("acct-1")
  })

  it("matches the title case-insensitively", async () => {
    await searchConversations(prisma, "acct-1", "produce")
    const or = findMany.mock.calls[0][0].where.OR
    expect(or).toContainEqual({ title: { contains: "produce", mode: "insensitive" } })
  })

  it("also matches the text of any turn in the thread", async () => {
    await searchConversations(prisma, "acct-1", "produce")
    const or = findMany.mock.calls[0][0].where.OR
    expect(or).toContainEqual({
      messages: { some: { content: { contains: "produce", mode: "insensitive" } } },
    })
  })

  it("returns the newest-updated threads first", async () => {
    await searchConversations(prisma, "acct-1", "produce")
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ updatedAt: "desc" })
  })

  it("falls back to a plain listing when the query is blank", async () => {
    await searchConversations(prisma, "acct-1", "   ")
    expect(findMany.mock.calls[0][0].where.OR).toBeUndefined()
    expect(findMany.mock.calls[0][0].where.accountId).toBe("acct-1")
  })

  it("trims the query so a stray space does not miss every row", async () => {
    await searchConversations(prisma, "acct-1", "  produce  ")
    const or = findMany.mock.calls[0][0].where.OR
    expect(or[0].title.contains).toBe("produce")
  })

  it("caps the result set", async () => {
    await searchConversations(prisma, "acct-1", "produce", 25)
    expect(findMany.mock.calls[0][0].take).toBe(25)
  })

  it("returns summaries in the same shape the rail already renders", async () => {
    const rows = await searchConversations(prisma, "acct-1", "produce")
    expect(rows).toEqual([
      {
        id: "c1",
        title: "Sales, week of Aug 11",
        createdAt: new Date("2026-08-18T00:00:00Z"),
        updatedAt: new Date("2026-08-19T00:00:00Z"),
        messageCount: 4,
      },
    ])
  })
})
