// The collapsed bars are the only thing an owner sees of these two queues on
// first paint, so their headline numbers are the contract. SHADOW decisions
// are deliberately invisible: the ladder proposed a link and wrote nothing,
// which is a developer's business, not the owner's.

import { describe, it, expect } from "vitest"
import {
  summarizeReviewQueue,
  summarizeAutoMatchNotice,
} from "@/lib/pantry-attention"

const group = (over: Partial<{ vendorName: string; totalSpend: number }> = {}) => ({
  vendorName: "Vitco Foodservice",
  totalSpend: 100,
  ...over,
})

const decision = (
  over: Partial<{ status: "APPLIED" | "UNDONE" | "SHADOW"; linkedLineItemCount: number }> = {},
) => ({
  status: "APPLIED" as const,
  linkedLineItemCount: 3,
  ...over,
})

describe("summarizeReviewQueue", () => {
  it("counts the groups and sums their spend", () => {
    const s = summarizeReviewQueue([
      group({ totalSpend: 2972 }),
      group({ totalSpend: 891 }),
      group({ totalSpend: 270 }),
    ])
    expect(s.count).toBe(3)
    expect(s.totalSpend).toBe(4133)
  })

  it("reports an empty queue as not worth showing", () => {
    const s = summarizeReviewQueue([])
    expect(s.count).toBe(0)
    expect(s.show).toBe(false)
  })

  it("shows a queue that has any group at all, however cheap", () => {
    // A $0 group is still an unmatched invoice line. Hiding it would leave
    // items permanently unreviewable from this page.
    expect(summarizeReviewQueue([group({ totalSpend: 0 })]).show).toBe(true)
  })
})

describe("summarizeAutoMatchNotice", () => {
  it("counts only decisions that actually wrote a link", () => {
    const s = summarizeAutoMatchNotice([
      decision({ status: "APPLIED" }),
      decision({ status: "APPLIED" }),
      decision({ status: "UNDONE" }),
    ])
    expect(s.liveCount).toBe(2)
    expect(s.undoneCount).toBe(1)
    expect(s.linkedLineCount).toBe(6)
    expect(s.show).toBe(true)
  })

  it("stays silent in shadow mode", () => {
    // The whole point of SHADOW is that nothing was written. An owner has
    // nothing to undo and nothing to check.
    const s = summarizeAutoMatchNotice([
      decision({ status: "SHADOW" }),
      decision({ status: "SHADOW" }),
    ])
    expect(s.liveCount).toBe(0)
    expect(s.show).toBe(false)
  })

  it("still shows when every live decision has been undone", () => {
    // The record that the automation was corrected here is the point of the
    // row; it is also what suppresses a re-link.
    const s = summarizeAutoMatchNotice([decision({ status: "UNDONE" })])
    expect(s.liveCount).toBe(0)
    expect(s.undoneCount).toBe(1)
    expect(s.show).toBe(true)
  })

  it("reports nothing to show on an empty week", () => {
    expect(summarizeAutoMatchNotice([]).show).toBe(false)
  })
})
