// Rail grouping. The prototype grouped threads under Today / Yesterday /
// Earlier with a perforated rule between. Buckets are computed against the
// reader's own day boundary, not UTC, or a thread from this evening reads as
// yesterday's.

import { describe, it, expect } from "vitest"
import { groupConversations } from "@/lib/chat/group-conversations"

const NOW = new Date("2026-08-20T15:00:00")

const c = (id: string, updatedAt: string) => ({
  id,
  title: id,
  updatedAt,
  createdAt: updatedAt,
  messageCount: 2,
})

describe("groupConversations", () => {
  it("returns no groups for an empty list", () => {
    expect(groupConversations([], NOW)).toEqual([])
  })

  it("puts this morning's thread under Today", () => {
    const g = groupConversations([c("a", "2026-08-20T09:00:00")], NOW)
    expect(g.map((x) => x.label)).toEqual(["Today"])
    expect(g[0].items.map((i) => i.id)).toEqual(["a"])
  })

  it("puts a thread from just before midnight under Yesterday", () => {
    const g = groupConversations([c("a", "2026-08-19T23:59:00")], NOW)
    expect(g[0].label).toBe("Yesterday")
  })

  it("puts anything older under Earlier", () => {
    const g = groupConversations([c("a", "2026-08-17T12:00:00")], NOW)
    expect(g[0].label).toBe("Earlier")
  })

  it("keeps the three buckets in order and omits empty ones", () => {
    const g = groupConversations(
      [
        c("old", "2026-08-01T12:00:00"),
        c("today", "2026-08-20T08:00:00"),
        c("yest", "2026-08-19T10:00:00"),
      ],
      NOW,
    )
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", "Earlier"])
  })

  it("omits a bucket with nothing in it", () => {
    const g = groupConversations([c("a", "2026-08-20T08:00:00")], NOW)
    expect(g).toHaveLength(1)
  })

  it("preserves the order the server sent within a bucket", () => {
    const g = groupConversations(
      [c("first", "2026-08-20T11:00:00"), c("second", "2026-08-20T09:00:00")],
      NOW,
    )
    expect(g[0].items.map((i) => i.id)).toEqual(["first", "second"])
  })

  it("counts a thread updated one minute after midnight as today", () => {
    const g = groupConversations([c("a", "2026-08-20T00:01:00")], NOW)
    expect(g[0].label).toBe("Today")
  })

  it("survives an unparseable timestamp by filing it under Earlier", () => {
    const g = groupConversations([c("a", "not-a-date")], NOW)
    expect(g[0].label).toBe("Earlier")
  })
})
