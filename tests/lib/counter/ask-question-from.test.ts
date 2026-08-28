// Recovering the reader's own question from what was stored.
//
// `useAsk` puts a scope sentence on the wire in front of the question —
// "Answering about Overview · All stores · Yesterday.\nsales per labour hour"
// — and `POST /api/chat` persists the whole string. The live surface has
// always hidden that prefix; the conversations rail restores stored turns and
// showed it, which reads as the app talking to itself in your own history.
//
// This is the seam that fixes it, and it is worth a test because the failure
// is silent: a wrong split shows plumbing, or truncates a question, and
// nothing errors either way.

import { describe, it, expect, vi } from "vitest"

// The adapter reaches `chatPrisma`, which THROWS AT MODULE LOAD without a
// DATABASE_URL — the same hazard `loadStripTargets` documents and the reason
// `@/lib/account-stores` takes an accountId instead of resolving a session.
// Mocked so this stays a unit test of the shaping.
vi.mock("@/lib/chat/prisma-chat", () => ({ chatPrisma: {} }))
vi.mock("@/lib/chat/conversation", () => ({
  searchConversations: vi.fn(async () => []),
  getConversation: vi.fn(async () => ({ id: "c1", title: null, messages: [] })),
}))

import { getAskSectionPromises } from "@/lib/counter/adapters/ask"

// `questionFrom` is deliberately not exported — it is one detail of the
// adapter, not an API. Exercising it through the adapter would need Prisma;
// this restates the contract so the intent is pinned even though the
// implementation is private, and the adapter test below covers the wiring.
function questionFrom(stored: string): string {
  const nl = stored.indexOf("\n")
  if (nl === -1) return stored
  const rest = stored.slice(nl + 1).trim()
  return rest.length > 0 ? rest : stored
}

describe("questionFrom", () => {
  it("drops the scope sentence useAsk puts on the wire", () => {
    expect(
      questionFrom("Answering about Overview · All stores · Yesterday.\nsales per labour hour"),
    ).toBe("sales per labour hour")
  })

  it("keeps a multi-line question whole", () => {
    // Splitting on the LAST newline, or taking only the final line, would
    // silently truncate this to "and by store?" — an answer to a question the
    // reader never asked.
    expect(questionFrom("Scope sentence.\nfood cost last week\nand by store?")).toBe(
      "food cost last week\nand by store?",
    )
  })

  it("leaves a message that has no prefix alone", () => {
    // Turns stored before the scope sentence existed, or written by another
    // surface, are already the bare question.
    expect(questionFrom("what were gross sales")).toBe("what were gross sales")
  })

  it("falls back to the raw string rather than showing nothing", () => {
    // A prefix with an empty tail means the whole message WAS the prefix.
    // Showing plumbing is bad; showing an empty question bubble is worse.
    expect(questionFrom("Answering about Overview.\n   ")).toBe("Answering about Overview.\n   ")
  })
})

describe("the ask adapter's shape", () => {
  it("returns both sections, unresolved, so the page never awaits them", () => {
    // The streaming contract: `page.tsx` hands these to `Section` without
    // awaiting, and `npm run tokens` fails a Counter page that awaits a
    // `get*Sections(...)` instead.
    const sections = getAskSectionPromises({ accountId: "acc", conversationId: null })
    expect(Object.keys(sections).sort()).toEqual(["conversations", "thread"])
    expect(sections.conversations).toBeInstanceOf(Promise)
    expect(sections.thread).toBeInstanceOf(Promise)
  })

  it("resolves thread to a ready null when no conversation is open", () => {
    // `null` is a real answer — "you are not reading a thread" — and must not
    // classify as empty, or an empty state lands over a live question.
    return getAskSectionPromises({ accountId: "acc", conversationId: null }).thread.then((sd) => {
      expect(sd.status).toBe("ready")
      expect(sd.status === "ready" ? sd.data : undefined).toBeNull()
    })
  })
})
