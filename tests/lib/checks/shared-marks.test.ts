import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { markDecision, type LatestMark } from "@/lib/checks/marks"

/**
 * Several crew work one check at once, each phone a few seconds behind the
 * others. One tap must never undo someone else's finished task by accident.
 */
const doneByAna: LatestMark = { id: "m1", done: true, note: null, crewName: "Ana R." }
const undone: LatestMark = { id: "m2", done: false, note: null, crewName: "Ana R." }

describe("markDecision", () => {
  it("saves a first tick", () => {
    expect(markDecision(null, { done: true, note: null, seen: null })).toBe("write")
    expect(markDecision(undone, { done: true, note: null, seen: null })).toBe("write")
  })

  it("keeps the first person's tick when a lagging phone ticks it again", () => {
    expect(markDecision(doneByAna, { done: true, note: null, seen: null })).toBe("keep")
  })

  it("saves a note on a done task", () => {
    expect(markDecision(doneByAna, { done: true, note: "Out of supplies", seen: null })).toBe("write")
  })

  it("undoes only the mark the phone showed", () => {
    expect(markDecision(doneByAna, { done: false, note: null, seen: "m1" })).toBe("write")
    expect(markDecision(doneByAna, { done: false, note: null, seen: "m0" })).toBe("stale")
    expect(markDecision(doneByAna, { done: false, note: null, seen: null })).toBe("stale")
  })

  it("ignores an undo of a task that is not done", () => {
    expect(markDecision(null, { done: false, note: null, seen: null })).toBe("keep")
    expect(markDecision(undone, { done: false, note: null, seen: "m1" })).toBe("keep")
  })
})
