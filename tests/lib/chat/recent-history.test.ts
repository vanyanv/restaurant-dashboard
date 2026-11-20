/*
 * getRecentHistory must hand the chat route the same rows the old
 * `getConversation(...).messages.filter(role, text).slice(-N)` did, while
 * reading only about N of them. Prisma is mocked with an in-memory table that
 * honours where / orderBy / skip / take, so the equivalence is checked on
 * threads that include system and tool rows and whitespace-only text.
 */
import { describe, it, expect, vi } from "vitest"
import { ConversationAccessError, getRecentHistory } from "@/lib/chat/conversation"
import type { PrismaClient } from "@/generated/prisma/client"

type Row = { id: string; role: string; content: string; createdAt: number }

function fakePrisma(rows: Row[], accountId = "acct-A") {
  const findMany = vi.fn(async (a: any) => {
    let out = rows
      .filter((r) => a.where.role.in.includes(r.role) && r.content !== "")
      .sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1))
    out = out.slice(a.skip ?? 0, (a.skip ?? 0) + a.take)
    return out.map((r) => ({ role: r.role, content: r.content }))
  })
  const prisma = {
    conversation: { findUnique: vi.fn(async () => (accountId ? { accountId } : null)) },
    message: { findMany },
  } as unknown as PrismaClient
  return { prisma, findMany }
}

const reference = (rows: Row[], n: number) =>
  [...rows]
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-n)
    .map((m) => ({ role: m.role, content: m.content }))

function thread(len: number, seed: number): Row[] {
  const roles = ["user", "assistant", "system", "tool", "assistant"]
  return Array.from({ length: len }, (_, i) => ({
    id: `m${String(i).padStart(4, "0")}`,
    role: roles[(i * 7 + seed) % roles.length],
    content: (i * 13 + seed) % 6 === 0 ? "  \n" : (i * 31 + seed) % 11 === 0 ? "" : `text ${i}`,
    createdAt: i,
  }))
}

describe("getRecentHistory", () => {
  it.each([0, 1, 5, 19, 20, 21, 80, 300].flatMap((len) => [0, 1, 2].map((seed) => [len, seed] as const)))(
    "matches filter+slice on a %i-message thread (seed %i)",
    async (len, seed) => {
      const rows = thread(len, seed)
      const { prisma } = fakePrisma(rows)
      expect(await getRecentHistory(prisma, "acct-A", "c1", 20)).toEqual(reference(rows, 20))
    },
  )

  it("reads about N rows from a long clean thread, in one query", async () => {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: `m${i}`, role: i % 2 ? "assistant" : "user", content: `t${i}`, createdAt: i,
    }))
    const { prisma, findMany } = fakePrisma(rows)
    const out = await getRecentHistory(prisma, "acct-A", "c1", 20)
    expect(out).toHaveLength(20)
    expect(out[19].content).toBe("t499")
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
  })

  it("never loads tool calls", async () => {
    const { prisma, findMany } = fakePrisma(thread(30, 0))
    await getRecentHistory(prisma, "acct-A", "c1", 20)
    expect(findMany.mock.calls[0][0].select).toEqual({ role: true, content: true })
  })

  it("keeps the ownership errors", async () => {
    await expect(getRecentHistory(fakePrisma([], "acct-B").prisma, "acct-A", "c1", 20)).rejects.toMatchObject({ code: "NOT_OWNED" })
    await expect(getRecentHistory(fakePrisma([], "").prisma, "acct-A", "c1", 20)).rejects.toBeInstanceOf(ConversationAccessError)
  })
})
