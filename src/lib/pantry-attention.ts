/**
 * Summaries for the two attention queues that sit above the pantry ledger.
 *
 * Both queues used to render in full on first paint and together owned ~750px
 * of a 900px viewport, which is why the ledger — the reason the page exists —
 * started below the fold. These summaries are what the collapsed bars show.
 *
 * Kept free of React so the counting rules (what SHADOW means, what an undone
 * decision still owes the reader) are testable on their own.
 */

export type ReviewQueueInput = {
  totalSpend: number
}

export type ReviewQueueSummary = {
  count: number
  totalSpend: number
  /** False only for an empty queue — any group at all is worth a bar. */
  show: boolean
}

export function summarizeReviewQueue(groups: ReviewQueueInput[]): ReviewQueueSummary {
  const totalSpend = groups.reduce((sum, g) => sum + g.totalSpend, 0)
  return { count: groups.length, totalSpend, show: groups.length > 0 }
}

export type AutoMatchNoticeInput = {
  status: "APPLIED" | "UNDONE" | "SHADOW"
  linkedLineItemCount: number
}

export type AutoMatchNoticeSummary = {
  /** Decisions that wrote a link and still stand. */
  liveCount: number
  /** Decisions that wrote a link and were reversed. Still shown: the row is
   *  the record of the correction, and it suppresses a re-link. */
  undoneCount: number
  /** Invoice lines touched by the standing links. */
  linkedLineCount: number
  show: boolean
}

export function summarizeAutoMatchNotice(
  decisions: AutoMatchNoticeInput[]
): AutoMatchNoticeSummary {
  let liveCount = 0
  let undoneCount = 0
  let linkedLineCount = 0

  for (const d of decisions) {
    // SHADOW wrote nothing. There is no link to inspect and nothing to undo,
    // so it never reaches the owner's pantry — it lives on the audit page.
    if (d.status === "APPLIED") {
      liveCount += 1
      linkedLineCount += d.linkedLineItemCount
    } else if (d.status === "UNDONE") {
      undoneCount += 1
    }
  }

  return {
    liveCount,
    undoneCount,
    linkedLineCount,
    show: liveCount + undoneCount > 0,
  }
}
